import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {request as httpRequest} from 'node:http'
import {parseCliLoginRequest,CLI_LOGIN_TIMEOUT_MS,type RuePlatformAccess} from '@multiterm/rue-sdk'
import {createControlCredentialStore} from '../src/auth/control-credentials.ts'
import {startControlLogin} from '../src/auth/control-login.ts'
const apiOrigin='https://api.rue.test',webOrigin='https://rue.test',token='tnk_'+'a'.repeat(43)
const access=():RuePlatformAccess=>({version:1,key:{id:'key_synthetic',owner:{type:'self',subject:'owner'},resourceOwner:'owner',expiresAt:Date.now()+3600000},fullPlatformAdministration:false,operations:[],unavailable:[]})

test('login requests are API-bound, short-lived and strictly loopback-only',()=>{
 const now=Date.now(),params=new URLSearchParams({apiOrigin,callback:'http://127.0.0.1:43210/callback',state:'a'.repeat(43),requestId:randomUUID(),expiresAt:String(now+CLI_LOGIN_TIMEOUT_MS)})
 assert.equal(parseCliLoginRequest('#'+params,apiOrigin,now).apiOrigin,apiOrigin)
 for(const callback of ['https://evil.test/callback','http://localhost:43210/callback','http://127.0.0.1:80/callback','http://user@127.0.0.1:43210/callback','http://127.0.0.1:43210/callback?token=secret','http://127.0.0.1:43210/callback#secret']){
  const changed=new URLSearchParams(params);changed.set('callback',callback);assert.throws(()=>parseCliLoginRequest('#'+changed,apiOrigin,now))
 }
 assert.throws(()=>parseCliLoginRequest('#'+params+'&state=another',apiOrigin,now))
 assert.throws(()=>parseCliLoginRequest('#'+params,'https://other.test',now))
 assert.throws(()=>parseCliLoginRequest('#'+params,apiOrigin,now+CLI_LOGIN_TIMEOUT_MS))
})

test('OS control credentials are origin-bound; secrets use stdin, never process arguments or provider storage',async()=>{
 for(const platform of ['darwin','linux'] as const){
  const calls:{args:string[];input?:string}[]=[],values=new Map<string,string>()
  const store=createControlCredentialStore(platform,async(binary,args,input)=>{
   calls.push({args,input});assert.ok(binary.startsWith('/usr/bin/'));assert.equal(args.join(' ').includes(token),false)
   const id=platform==='darwin'?(input?.match(/ -a ([a-f0-9]{64}) /)?.[1]??args[args.indexOf('-a')+1]!):args.at(-1)!
   if(args[0]==='-i'||args[0]==='store'){values.set(id,platform==='darwin'?input!.match(/ -w (\S+)/)![1]!:input!);return {code:0,stdout:''}}
   if(args[0]==='delete-generic-password'||args[0]==='clear'){values.delete(id);return {code:0,stdout:''}}
   return {code:values.has(id)?0:platform==='darwin'?44:1,stdout:values.get(id)??''}
  })
  await store.set(apiOrigin,token);assert.equal(await store.get(apiOrigin),token);assert.equal(await store.get('https://other.test'),null)
  assert.equal(calls.some(c=>c.input?.includes(token)),true);assert.equal(calls.some(c=>c.args.includes('rue-control')||c.input?.includes('rue-control')),true)
  await store.remove(apiOrigin);assert.equal(await store.get(apiOrigin),null)
  await assert.rejects(store.set(apiOrigin,token+'\ncommand'),/credential_invalid/)
 }
 await assert.rejects(createControlCredentialStore('win32',async()=>{throw Error('must not run')}).get(apiOrigin),/store_unavailable/)
 await assert.rejects(createControlCredentialStore('darwin',async()=>({code:0,stdout:'not a key'})).get(apiOrigin),/store_unavailable/)
})

test('real loopback listener enforces origin, host, state and one-winner callback before storing API-verified credentials',async()=>{
 const stored:{origin:string;token:string}[]=[];let verified=0,release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 const login=await startControlLogin({apiOrigin,webOrigin,store:{get:async()=>null,set:async(origin,token)=>{stored.push({origin,token})},remove:async()=>{}},fetch:async(url,init)=>{
  verified++;assert.equal(String(url),apiOrigin+'/platform/access');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+token)
  await gate;return Response.json(access())
 }})
 try{
  const request=parseCliLoginRequest(new URL(login.url).hash,apiOrigin),body={state:request.state,token,subject:'owner',keyId:'key_synthetic'}
  assert.equal(new URL(login.url).search,'');assert.equal(login.url.includes(token),false)
  const submit=(value:unknown=body,origin=webOrigin,extra:Record<string,string>={})=>fetch(request.callback,{method:'POST',headers:{origin,'content-type':'application/json',...extra},body:JSON.stringify(value),signal:AbortSignal.timeout(5000)})
  assert.equal((await submit(body,'https://evil.test')).status,403)
  // Fetch deliberately replaces Host; use raw HTTP to test DNS-rebinding defenses.
  assert.equal(await new Promise<number|undefined>((resolve,reject)=>{const req=httpRequest(request.callback,{method:'POST',headers:{host:'attacker.test',origin:webOrigin,'content-type':'application/json'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end('{}')}),403)
  assert.equal((await submit({...body,state:'x'.repeat(43)})).status,400)
  assert.equal((await submit(body,webOrigin,{'content-type':'text/plain'})).status,415)
  assert.equal((await submit({...body,extra:'x'.repeat(4096)})).status,413)
  const preflight=await fetch(request.callback,{method:'OPTIONS',headers:{origin:webOrigin,'access-control-request-method':'POST','access-control-request-headers':'content-type','access-control-request-private-network':'true'}})
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),webOrigin);assert.equal(preflight.headers.get('access-control-allow-private-network'),'true')
  assert.equal(stored.length,0);assert.equal(verified,0)
  const first=submit();for(let i=0;i<100&&verified===0;i++)await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(verified,1);assert.equal((await submit()).status,409);assert.equal(stored.length,0)
  release();assert.equal((await first).status,204);assert.equal((await login.result).key.resourceOwner,'owner');assert.deepEqual(stored,[{origin:apiOrigin,token}])
 }finally{release();login.cancel()}
})

test('wrong-owner keys and expired requests never become stored CLI credentials',async()=>{
 let writes=0
 const store={get:async()=>null,set:async()=>{writes++},remove:async()=>{}}
 const login=await startControlLogin({apiOrigin,webOrigin,store,fetch:async()=>Response.json({...access(),key:{...access().key,resourceOwner:'other'}})})
 try{
  const request=parseCliLoginRequest(new URL(login.url).hash,apiOrigin)
  assert.equal((await fetch(request.callback,{method:'POST',headers:{origin:webOrigin,'content-type':'application/json'},body:JSON.stringify({state:request.state,token,subject:'owner',keyId:'key_synthetic'})})).status,400)
  await assert.rejects(login.result,/rue_auth_login_failed/);assert.equal(writes,0)
 }finally{login.cancel()}
 const expired=await startControlLogin({apiOrigin,webOrigin,store,timeoutMs:10})
 await assert.rejects(expired.result,/rue_auth_login_timed_out/);assert.equal(writes,0)
 const cancelled=await startControlLogin({apiOrigin,webOrigin,store});cancelled.cancel();await assert.rejects(cancelled.result,/rue_auth_login_cancelled/)
})
