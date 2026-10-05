import {test} from 'node:test'
import assert from 'node:assert/strict'
import {brokerCredential} from '../extensions/rue/provider-keys.ts'
const source=(patch={})=>({kind:'terminal',origin:'https://rue.test',id:'term_test',token:'synthetic-machine-secret',instance:'instance',signal:new AbortController().signal,current:()=>true,...patch})
const signal=()=>new AbortController().signal
const success=()=>Response.json({provider:'openai-codex',credentialType:'oauth',accessToken:'e30.e30.signature',expiresAt:Date.now()+60000})
test('credential fetch survives temporary API restarts without replaying an inference request',async()=>{
 let calls=0
 const fetcher=async(url,init)=>{calls++;assert.ok(url.endsWith('/provider-keys/openai-codex'));assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');return calls<3?new Response('private upstream details',{status:calls===1?502:503}):success()}
 const result=await brokerCredential(source(),'openai-codex','key',signal(),fetcher)
 assert.equal(result.accessToken,'e30.e30.signature');assert.equal(calls,3)
})
test('network failure retries only retrieval; repeated successful reads do not cache keys',async()=>{
 let calls=0
 const fetcher=async()=>{if(++calls===1)throw Error('private transport detail');return success()}
 await brokerCredential(source(),'openai-codex','key',signal(),fetcher)
 await brokerCredential(source(),'openai-codex','key',signal(),fetcher)
 assert.equal(calls,3)
})
test('explicit denial, revocation and stale instance fail closed without retry',async()=>{
 for(const status of [400,401,403,404,409]){let calls=0;assert.equal(await brokerCredential(source(),'openai-codex','key',signal(),async()=>{calls++;return new Response('private error',{status})}),undefined);assert.equal(calls,1)}
})
test('abort and lost lease terminate backoff; late credentials are discarded',async()=>{
 const abort=new AbortController();let calls=0
 const result=brokerCredential(source(),'openai-codex','key',abort.signal,async()=>{calls++;return new Response('',{status:503})})
 setTimeout(()=>abort.abort(),30);assert.equal(await result,undefined);assert.equal(calls,1)
 let current=true;calls=0
 assert.equal(await brokerCredential(source({current:()=>current}),'openai-codex','key',signal(),async()=>{calls++;current=false;return success()}),undefined);assert.equal(calls,1)
})
test('bounded exhaustion reports a sanitized status, never response bodies or credentials',async()=>{
 let calls=0
 await assert.rejects(brokerCredential(source(),'openai-codex','key',signal(),async()=>{calls++;return new Response('upstream-private-error synthetic-machine-secret',{status:503})}),error=>error.message.includes('HTTP 503')&&!error.message.includes('upstream-private-error')&&!error.message.includes('synthetic-machine-secret'))
 assert.equal(calls,4)
})
