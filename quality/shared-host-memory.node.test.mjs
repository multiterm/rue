import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {DEFAULT_AGENT_LIMIT,AGENT_RESOURCES,memoryBoundCapacity} from '../packages/apps/worker/src/resources.ts'
import {ManagedSupervisor} from '../packages/apps/worker/src/managed.ts'
import {runtimePolicy} from '../packages/apps/worker/src/policy.ts'
import {atomicState} from '../packages/apps/worker/src/config.ts'
import {reconcile} from '../packages/apps/worker/src/reconcile.ts'
const GiB=1024**3,image='sha256:'+'a'.repeat(64)
test('10 shared slots do not require 40 GiB; low memory still blocks admission and hard ceilings remain',()=>{
 assert.equal(DEFAULT_AGENT_LIMIT,10);assert.equal(AGENT_RESOURCES.Memory,4*GiB)
 assert.equal(memoryBoundCapacity(10,12*GiB,5*GiB),10)
 assert.equal(memoryBoundCapacity(1,12*GiB,5*GiB),1)
 for(const memory of [0,GiB,2*GiB,NaN,Infinity,13*GiB])assert.equal(memoryBoundCapacity(10,12*GiB,memory),0)
})
test('new policies default to 10, but an operator’s persisted one-agent limit is never silently overridden',()=>{
 const stateDir=mkdtempSync(join(tmpdir(),'rue-memory-policy-')),cfg={origin:'https://rue.test',id:randomUUID(),stateDir}
 try{assert.equal(runtimePolicy(cfg,{RUE_WORKER_AGENT_IMAGE:image}).capacity,10)
 const previous={origin:cfg.origin,id:cfg.id,image,capacity:1};atomicState(stateDir,'runtime-policy.json',previous);assert.equal(runtimePolicy(cfg,{}).capacity,1)
 }finally{rmSync(stateDir,{recursive:true,force:true})}
})
function agent(workerId){return {id:randomUUID(),workerId,sessionId:'ses_'+randomUUID(),connectionId:'term_'+randomUUID().replaceAll('-',''),name:'Agent',desired:'running',revision:1,createdAt:1,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false},observed:'pending',observedRevision:null,observedGeneration:null,observedAt:null,error:null,busy:false,connected:false,grantRevision:null,grantGeneration:null,grantBoot:null}}
test('real supervisor serializes boots, waits for startup, then admits another agent without stopping the first',async()=>{
 const stateDir=mkdtempSync(join(tmpdir(),'rue-shared-memory-')),workerId=randomUUID(),agents=Array.from({length:3},()=>agent(workerId)),containers=[],starts=[]
 const supervisor=new ManagedSupervisor({id:workerId,origin:'https://rue.test',dockerSocket:'/unused',stateDir,secret:'fixture'},randomUUID(),image,10)
 supervisor.observed({generation:1,worker:{ownerSubject:'owner'}},{mono:performance.now()+60000,wall:Date.now()+60000})
 let available=true;supervisor.resourcesAvailable=()=>available
 supervisor.containers.inventory=async()=>containers
 supervisor.containers.prepare=async()=>{}
 supervisor.containers.remove=async()=>assert.fail('Running agents must not be evicted')
 supervisor.containers.start=async(a,intent)=>{starts.push(a.id);containers.push({id:randomUUID(),agentId:a.id,generation:1,revision:1,boot:intent.boot,running:true})}
 supervisor.post=async(path,body)=>{
  if(path==='snapshot')return {generation:1,serverNow:Date.now(),expiresAt:Date.now()+60000,desired:'active',agents}
  const a=agents.find(a=>path.startsWith(a.id+'/'));assert.ok(a)
  if(path.endsWith('/grant')){a.grantRevision=1;a.grantGeneration=1;a.grantBoot=body.boot;return {id:a.connectionId,token:'rue_terminal_'+'t'.repeat(43),sessionId:a.sessionId,piSessionId:a.id,ownerSubject:'owner',generation:1,boot:body.boot}}
  if(path.endsWith('/report')){a.observed=body.report.state;a.observedAt=Date.now();a.observedRevision=1;a.observedGeneration=1;return {}}
  assert.fail(path)
 }
 try{
  await supervisor.tick();assert.equal(starts.length,1,'only one start per sample, not ten simultaneous allocations')
  await supervisor.tick();assert.equal(starts.length,1,'startup cooldown survives reconciliation ticks')
  supervisor.lastLaunch=-Infinity;await supervisor.tick();assert.equal(starts.length,1,'wait for first agent to connect')
  agents[0].connected=true;await supervisor.tick();assert.equal(starts.length,2)
  agents[1].connected=true;supervisor.lastLaunch=-Infinity;available=false;await supervisor.tick();assert.equal(starts.length,2);assert.equal(containers.length,2)
  available=true;await supervisor.tick();assert.equal(starts.length,3)
 }finally{supervisor.stop();rmSync(stateDir,{recursive:true,force:true})}
})
test('memory pressure defers reload before removal and consumes no boot attempts',async()=>{
 const a={...agent(randomUUID()),revision:2},old={id:'old',agentId:a.id,generation:1,revision:1,boot:1,running:true}
 await reconcile({generation:1,desired:'active',agents:[a]},{authorized:()=>true,inventory:async()=>[old],load:()=>undefined,canStart:()=>false,save:()=>assert.fail('no attempt'),prepare:async()=>assert.fail('no preparation'),remove:async()=>assert.fail('no removal'),start:async()=>assert.fail('no start'),report:async()=>assert.fail('no false startup failure'),purge:async()=>assert.fail('no purge')},10)
})
