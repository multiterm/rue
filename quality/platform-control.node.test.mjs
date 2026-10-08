import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createRueClient,RUE_KEY_PRESETS} from '../packages/libs/sdk/src/index.ts'
import {platformAccess} from '../packages/apps/core/src/server/platform-access.ts'
import {tenancyKeyApi,keyPermissionsFor} from '../packages/apps/core/src/server/tenancy-key-api.ts'
import {controlCommand,readControlConfig} from '../packages/apps/core/src/cli/control.ts'
const key=()=>({id:'key_fixture',owner:{type:'self',subject:'usr_fixture'},service:'rue',grants:[...RUE_KEY_PRESETS.All],name:'fixture',createdAt:Date.now(),expiresAt:Date.now()+60000,revokedAt:null})
const config={provider:'openai',model:'test',permission:'coding',mounts:[],shareToolOutput:false,shareThinking:true,filesystem:{version:1,directories:[{path:'/Users/calvin/projects',access:'read'}]}}
test('all supported scopes remain owner-scoped, not platform-root authority',()=>{
 const access=platformAccess(key(),true)
 assert.equal(access.fullPlatformAdministration,false);assert.equal(access.key.resourceOwner,'usr_fixture')
 assert.ok(access.operations.every(op=>op.status==='authorized'))
 assert.ok(access.unavailable.some(op=>op.id==='host.filesystem'))
 const wildcard=platformAccess({...key(),grants:['rue:admin','rue:platform:admin','*']},true)
 assert.ok(wildcard.operations.every(op=>op.status==='missing_permissions'))
 assert.equal(platformAccess(key(),false).operations.find(op=>op.id==='agents.configure').status,'disabled')
 const project=platformAccess({...key(),owner:{type:'project',organizationId:'org_fixture',projectId:'prj_fixture'}},true)
 assert.equal(project.key.resourceOwner,'tenancy:project:org_fixture:prj_fixture')
})
test('access endpoint verifies the current key, never trusts an owner parameter, and fails closed',async()=>{
 let value=key(),failure=false,calls=0
 const app=tenancyKeyApi({projectAuthority:{verifier:{verifyKey:async()=>{calls++;if(failure)throw Error('private upstream error');return value}}}},true)
 const request=(path='/platform/access?owner=another-user',method='GET')=>app.request('https://rue.test'+path,{method,headers:{authorization:'Bearer tnk_fixture'}})
 let response=await request();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/)
 let body=await response.json();assert.equal(body.key.resourceOwner,'usr_fixture');assert.equal(JSON.stringify(body).includes('tnk_fixture'),false)
 value={...key(),grants:['rue:platform:admin']};assert.equal((await request('/workers')).status,403)
 assert.equal((await request('/platform/execute','POST')).status,401)
 assert.deepEqual(keyPermissionsFor('GET','/platform/access'),[]);assert.equal(keyPermissionsFor('POST','/platform/access'),undefined)
 value={...key(),expiresAt:Date.now()-1};assert.equal((await request()).status,401)
 value=undefined;assert.equal((await request()).status,401)
 failure=true;response=await request();assert.equal(response.status,503);assert.equal((await response.text()).includes('private upstream'),false)
 assert.ok(calls>=5)
})
test('SDK discovery and single-agent mutations use bounded named routes without redirects',async()=>{
 const requests=[],client=createRueClient({baseUrl:'https://rue.test',token:'fixture',fetch:async(url,init)=>{requests.push({url,init});return Response.json({})}}),id=randomUUID(),requestId=randomUUID()
 await client.platformAccess();assert.equal(requests[0].url,'https://rue.test/platform/access');assert.equal(requests[0].init.cache,'no-store')
 await client.configureManagedAgent(id,{requestId,expectedRevision:3,config,acknowledgeExecution:true,acknowledgeFilesystem:true,action:'purge'})
 assert.equal(JSON.parse(requests[1].init.body).action,'configure')
 await client.upgradeManagedAgent(id,{requestId,expectedRevision:3,image:'sha256:'+'a'.repeat(64),expectedImage:'sha256:'+'b'.repeat(64),piVersion:'0.85.1',acknowledgeExecution:true})
 assert.equal(JSON.parse(requests[2].init.body).action,'upgrade');assert.ok(requests.every(request=>request.init.redirect==='error'))
})
test('CLI configuration files are private, bounded, schema-checked and cannot smuggle credentials',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rue-platform-config-')),file=join(dir,'config.json')
 try{
  writeFileSync(file,JSON.stringify(config),{mode:0o600});assert.deepEqual(readControlConfig(file),config)
  chmodSync(file,0o644);assert.throws(()=>readControlConfig(file),/config_file_invalid/);chmodSync(file,0o600)
  symlinkSync(file,join(dir,'link'));assert.throws(()=>readControlConfig(join(dir,'link')),/config_file_invalid/)
  for(const value of [{...config,apiKey:'DO_NOT_PRINT'},{...config,filesystem:{version:1,directories:[{path:'/Users/calvin',access:'write'}]}}]){
   writeFileSync(file,JSON.stringify(value));assert.throws(()=>readControlConfig(file),error=>error.message==='rue_control_config_file_invalid')
  }
  writeFileSync(file,'x'.repeat(65537));assert.throws(()=>readControlConfig(file),/config_file_invalid/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('CLI requires acknowledgements, fences revisions, never auto-resumes and reports uncertain submissions',async()=>{
 const commands=[],builder={option(){return this},command(command){commands.push(command);return this},demandCommand(){return this},strict(){return this}}
 controlCommand.builder(builder)
 const handler=name=>commands.find(command=>command.command===name).handler
 const dir=mkdtempSync(join(tmpdir(),'rue-platform-cli-')),tokenFile=join(dir,'token'),configFile=join(dir,'config.json'),requests=[],outputs=[]
 const previousFetch=globalThis.fetch,previousWrite=process.stdout.write,previousExit=process.exitCode
 try{
  writeFileSync(tokenFile,'tnk_fixture_key',{mode:0o600});writeFileSync(configFile,JSON.stringify(config),{mode:0o600})
  globalThis.fetch=async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return Response.json({agent:{id:'agent'},operation:{id:'operation'}})}
  process.stdout.write=function(chunk){outputs.push(String(chunk));return true}
  const base={apiUrl:'https://rue.test',tokenFile,configFile,id:randomUUID(),requestId:randomUUID(),expectedRevision:3}
  await handler('agent-configure <id>')({...base});assert.equal(requests.length,0)
  await handler('agent-configure <id>')({...base,acknowledgeExecution:true});assert.equal(requests.length,0)
  await handler('agent-configure <id>')({...base,acknowledgeExecution:true,acknowledgeFilesystem:true})
  assert.equal(requests.length,1);assert.equal(requests[0].body.expectedRevision,3);assert.equal(requests[0].body.action,'configure');assert.deepEqual(requests[0].body.config,config)
  await handler('agent-upgrade <id>')({...base,image:'sha256:'+'a'.repeat(64),expectedImage:'sha256:'+'b'.repeat(64),piVersion:'0.85.1',acknowledgeExecution:true})
  assert.equal(requests.length,2);assert.equal(requests[1].body.action,'upgrade')
  globalThis.fetch=async()=>Response.json({worker:{id:'worker'},secret:'MUST_NOT_PRINT'})
  await handler('host-action <id>')({...base,requestId:undefined,action:'drain',acknowledgeHostControl:true})
  assert.equal(outputs.join('').includes('MUST_NOT_PRINT'),false)
  globalThis.fetch=async()=>{throw Error('PRIVATE_TRANSPORT_DETAIL')}
  await handler('host-action <id>')({...base,requestId:undefined,action:'activate',acknowledgeHostControl:true})
  assert.equal(JSON.parse(outputs.at(-1)).resultUnconfirmed,true)
  assert.equal(outputs.join('').includes('PRIVATE_TRANSPORT_DETAIL'),false);assert.equal(outputs.join('').includes('tnk_fixture_key'),false)
 }finally{globalThis.fetch=previousFetch;process.stdout.write=previousWrite;process.exitCode=previousExit;rmSync(dir,{recursive:true,force:true})}
})
