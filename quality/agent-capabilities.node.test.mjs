import {test} from 'node:test'
import assert from 'node:assert/strict'
import {latestPiRelease} from '../packages/apps/core/src/server/pi-release.ts'
import {runtimeInfo} from '../extensions/rue/runtime-info.ts'
import {agentStatus} from '../extensions/rue/status.ts'
import {Bridge} from '../extensions/rue/bridge.ts'
import {brokerCredential} from '../extensions/rue/provider-keys.ts'
import {agentStatusSchema,mergeAgentStatus,acknowledgedCatalogHash} from '../packages/apps/core/src/storage/agent-status.ts'
import {localRuntimeRelease} from '../packages/apps/worker/src/runtime-releases.ts'
import {upgradeCandidate,comparePiVersions} from '../packages/apps/webapp/src/agent-upgrade-policy.ts'
test('published Pi lookup is bounded, credential-free and cached; failures retain an explicitly dated observation',async()=>{
 let calls=0;const now=Date.now()
 const fetcher=async(url,init)=>{calls++;assert.equal(new URL(url).hostname,'registry.npmjs.org');assert.equal(init.redirect,'error');assert.deepEqual(Object.keys(init.headers),['accept']);return Response.json({latest:'0.86.0'})}
 assert.deepEqual(await latestPiRelease(fetcher,now),{latestVersion:'0.86.0',checkedAt:now})
 await latestPiRelease(fetcher,now+1000);assert.equal(calls,1)
 assert.deepEqual(await latestPiRelease(async()=>{throw Error('private upstream details')},now+300001),{latestVersion:'0.86.0',checkedAt:now})
 assert.deepEqual(await latestPiRelease(async()=>Response.json({latest:'not a version'}),now+600002),{latestVersion:'0.86.0',checkedAt:now})
})
const model={provider:'future-provider',id:'new-model',name:'New Model',contextWindow:123456,apiKey:'private-fixture',headers:{authorization:'private-fixture'}}
const providers=[{id:'future-provider',name:'Future Provider',auth:{apiKey:{secret:'private-fixture'}}}]
test('catalog is runtime-derived, bounded and strips non-allowlisted model/provider fields',()=>{
 const info=runtimeInfo('0.86.0',[model],providers)
 assert.equal(info.catalog.providers[0].id,'future-provider');assert.equal(info.catalog.providers[0].models[0].id,'new-model')
 assert.equal(info.catalog.providers[0].credentialMode,'api_key');assert.equal(JSON.stringify(info).includes('private-fixture'),false)
 const report=agentStatus({cwd:'/workspace',branch:null,idle:true,thinking:'off',entries:[],runtime:info})
 assert.equal(agentStatusSchema.safeParse(report).success,true)
 assert.equal(runtimeInfo('invalid',[model],providers).piVersion,null)
 const big=runtimeInfo('0.86.0',Array.from({length:10000},(_,i)=>({...model,id:'model-'+i})),providers)
 assert.equal(big.catalog.truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(big))<512*1024)
})
test('catalog acknowledgments retain only matching, validated catalogs, not stale versions or malformed history',()=>{
 const full=agentStatus({cwd:'/workspace',branch:null,idle:true,thinking:'off',entries:[],runtime:runtimeInfo('0.86.0',[model],providers)})
 const stored=mergeAgentStatus(undefined,agentStatusSchema.parse(full)),{catalog,...summary}=full
 assert.equal(acknowledgedCatalogHash(stored),full.catalogHash)
 assert.deepEqual(mergeAgentStatus(stored,summary).catalog,catalog)
 assert.equal(mergeAgentStatus(stored,{...summary,piVersion:'0.87.0'}).catalog,undefined)
 assert.equal(mergeAgentStatus(undefined,summary).catalogHash,undefined)
 assert.equal(mergeAgentStatus({...stored,catalog:{providers:[],truncated:false}},summary).catalog,undefined)
 assert.equal(acknowledgedCatalogHash({...summary}),undefined)
 const bridge=new Bridge({origin:'https://rue.test',id:'test',token:'test',piSessionId:'test',outbox:[],shareStatus:true},{save(){}},{idle:()=>true,status:()=>full,send(){},cancel(){},notify(){},confirm:async()=>false})
 bridge.catalogSupported=true;bridge.catalogAck=full.catalogHash;assert.equal(bridge.health().status.catalog,undefined);assert.equal(bridge.health().status.catalogHash,full.catalogHash)
 bridge.catalogAck=undefined;assert.deepEqual(bridge.health().status.catalog,catalog);bridge.stop()
})
test('new telemetry is negotiated; older APIs receive the original status shape',()=>{
 const status=agentStatus({cwd:'/workspace',branch:null,idle:true,thinking:'off',entries:[],runtime:runtimeInfo('0.86.0',[model],providers)})
 const bridge=new Bridge({origin:'https://rue.test',id:'test',token:'test',piSessionId:'test',outbox:[],shareStatus:true},{save(){}},{idle:()=>true,status:()=>status,send(){},cancel(){},notify(){},confirm:async()=>false})
 assert.equal(bridge.health().status.piVersion,undefined);assert.equal(bridge.health().status.catalog,undefined)
 bridge.catalogSupported=true;assert.equal(bridge.health().status.piVersion,'0.86.0');bridge.stop()
})
test('upgrade candidates are immutable, newer and architecture/filesystem compatible',()=>{
 const a='sha256:'+'a'.repeat(64),b='sha256:'+'b'.repeat(64)
 const metadata={Id:b,Os:'linux',Architecture:'arm64',Created:'2026-09-25T00:00:00Z',Config:{Labels:{'io.rue.agent-runtime':'1','io.rue.pi-sdk':'0.86.0','io.rue.filesystem':'2'}}}
 assert.equal(localRuntimeRelease(metadata,true,'arm64').piVersion,'0.86.0')
 assert.equal(localRuntimeRelease(metadata,true,'x64'),undefined)
 assert.equal(localRuntimeRelease({...metadata,Config:{Labels:{...metadata.Config.Labels,'io.rue.filesystem':'1'}}},true,'arm64'),undefined)
  const v3={...metadata,Config:{Labels:{...metadata.Config.Labels,'io.rue.filesystem':'3'}}}
  assert.ok(localRuntimeRelease(v3,true,'arm64'))
  assert.ok(localRuntimeRelease(v3,'workspace-roots','arm64'))
  assert.equal(localRuntimeRelease(metadata,'workspace-roots','arm64'),undefined)
 const releases=[{image:a,piVersion:'0.85.1',createdAt:1},{image:b,piVersion:'0.86.0',createdAt:2}]
 assert.equal(upgradeCandidate(releases,a,'0.85.1').image,b)
 assert.equal(upgradeCandidate(releases,b,'0.86.0'),undefined)
 assert.equal(upgradeCandidate(releases,a,'0.87.0'),undefined)
 assert.equal(comparePiVersions('0.9.0','0.10.0'),-1)
 assert.equal(comparePiVersions('0.86.0-beta','0.85.1'),undefined)
})
test('future native API-key providers use the same bound broker; URL-like identifiers are rejected',async()=>{
 const controller=new AbortController(),source={kind:'terminal',origin:'https://rue.test',id:'fixture',token:'fixture',instance:'fixture',signal:controller.signal,current:()=>true};let requests=0
 const fetcher=async url=>{requests++;assert.ok(url.endsWith('/provider-keys/future-provider'));return Response.json({provider:'future-provider',granted:true})}
 assert.equal((await brokerCredential(source,'future-provider','availability',controller.signal,fetcher)).granted,true)
 assert.equal(await brokerCredential(source,'../../other','availability',controller.signal,fetcher),undefined)
 assert.equal(requests,1)
})
