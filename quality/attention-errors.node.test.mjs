import {test} from 'node:test'
import assert from 'node:assert/strict'
import {attentionProblems,managedRuntimeProblem,remoteSetupProblems,setupHelp} from '../packages/apps/webapp/src/agent-setup-help.ts'
import {checkManagedPromptCredentials} from '../packages/apps/webapp/src/managed-prompt-preflight.ts'

const healthy={status:'online',relayProtocol:2,leaseExpiresAt:100,health:{agentWorking:false,uploadFailures:0},runs:[]}
test('attention stays hidden for normal lifecycle states and initial checks',()=>{
 for(const code of ['not_ready','stopped','destroyed'])assert.deepEqual(attentionProblems({status:'offline'},false,false,code),[])
 assert.deepEqual(attentionProblems({status:'offline'},false,false,undefined,true),[])
 for(const state of ['idle','working','compacting'])assert.deepEqual(attentionProblems({...healthy,health:{...healthy.health,status:{state}}},true,false),[])
 assert.deepEqual(attentionProblems(healthy,true,false,'oauth_refreshing'),[])
 assert.deepEqual(attentionProblems({status:'unconfirmed'},false,false),[])
})
test('a transient OAuth refresh does not hide an independent confirmed connection failure',()=>{
 assert.deepEqual(attentionProblems({status:'offline'},false,false,'oauth_refreshing'),['disconnected'])
})
test('missing freshness evidence is not a confirmed timeout',()=>{
 for(const computer of [{status:'online'},{status:'online',relayProtocol:2,leaseExpiresAt:null},{status:'online',lastSeenAt:NaN}])assert.deepEqual(remoteSetupProblems(computer,false,false),[])
 assert.deepEqual(remoteSetupProblems({...healthy,leaseExpiresAt:1},false,false),['connection_timeout'])
})
test('all independent current errors have separate guides and duplicate check failures collapse',()=>{
 const computer={...healthy,health:{...healthy.health,uploadFailures:2},runs:[{status:'failed',created_at:10,updated_at:10}]}
 assert.deepEqual(attentionProblems(computer,true,true,'check_failed'),['check_failed','uploads','task_failed'])
 const codes=attentionProblems(computer,true,false,'grant_missing')
 assert.deepEqual(codes,['uploads','task_failed','grant_missing'])
 assert.equal(new Set(codes.map(code=>setupHelp(code).title)).size,codes.length)
})
test('stale remote snapshots do not resurrect historical task/upload failures',()=>{
 const computer={...healthy,status:'offline',health:{uploadFailures:5},runs:[{status:'failed',updated_at:10}]}
 assert.deepEqual(remoteSetupProblems(computer,false,false),['disconnected'])
})
test('task selection uses request creation order rather than late updates to old failures',()=>{
 const runs=[{status:'failed',created_at:1,updated_at:100},{status:'completed',created_at:2,updated_at:3}]
 assert.deepEqual(remoteSetupProblems({...healthy,runs},true,false),[])
 for(const state of ['working','compacting'])assert.deepEqual(remoteSetupProblems({...healthy,health:{status:{state}},runs:[runs[0]]},true,false),[])
})
test('failed, interrupted and expired task outcomes have distinct tutorials',()=>{
 for(const [status,expiredBeforeDispatch,code] of [['failed',false,'task_failed'],['interrupted',false,'task_interrupted'],['expired',false,'task_expired'],['expired',true,'task_not_dispatched']]){
  assert.deepEqual(remoteSetupProblems({...healthy,runs:[{status,expiredBeforeDispatch,updated_at:1}]},true,false),[code])
  assert.ok(setupHelp(code)?.steps.length>=2)
 }
 assert.equal(setupHelp('task_not_dispatched').action,'queue')
})
test('known host/runtime failures keep their specific diagnostic and unknown failures stay generic',()=>{
 for(const error of ['capacity_unavailable','mount_unavailable','runtime_unavailable','ownership_conflict','authority_lost']){
  const code=managedRuntimeProblem({observed:'failed',desired:'running',error})
  assert.equal(code,error);assert.ok(setupHelp(code))
 }
 assert.equal(managedRuntimeProblem({observed:'failed',desired:'stopped',runtimeUpdateState:'failed'}),'runtime_update_failed')
 assert.equal(managedRuntimeProblem({observed:'failed',desired:'running',error:'agent_model_unavailable'}),'model_unavailable')
 assert.equal(managedRuntimeProblem({observed:'failed',desired:'running',error:'private details'}),'runtime_failed')
 assert.equal(managedRuntimeProblem({observed:'stopped',desired:'stopped'}),undefined)
 assert.equal(managedRuntimeProblem({observed:'failed',desired:'destroyed'}),undefined)
})
test('preflight reports a failed unpaired runtime, but normal starting and stopped states remain non-errors',async()=>{
 const session={id:'session',ownerSubject:'owner',terminalConnectionId:null,meta:{managedAgentId:'agent'}}
 const agent={id:'agent',sessionId:'session',connectionId:null,desired:'running',observed:'failed',error:'mount_unavailable'}
 const client={managedAgents:async()=>({agents:[agent]}),providerKeys:async()=>({ownerSubject:'owner',keyStorageAvailable:true,keys:[]})}
 await assert.rejects(checkManagedPromptCredentials(client,session,'owner',()=>true),error=>error.code==='mount_unavailable')
 agent.desired='stopped';agent.error='runtime_failed'
 await assert.rejects(checkManagedPromptCredentials(client,session,'owner',()=>true),error=>error.code==='runtime_failed')
 agent.observed='stopped'
 await assert.rejects(checkManagedPromptCredentials(client,session,'owner',()=>true),error=>error.code==='stopped'&&!setupHelp(error.code))
 agent.desired='running';agent.observed='starting'
 await assert.rejects(checkManagedPromptCredentials(client,session,'owner',()=>true),error=>error.code==='not_ready'&&!setupHelp(error.code))
})
test('guides do not interpret inherited properties as error codes',()=>{
 for(const code of ['toString','constructor','__proto__','unknown'])assert.equal(setupHelp(code),undefined)
})
