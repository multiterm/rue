import {test} from 'node:test'
import assert from 'node:assert/strict'
import {setupHelp,remoteSetupProblem} from '../packages/apps/webapp/src/agent-setup-help.ts'
test('initial/loading/transient states and healthy idle agents have no setup card',()=>{
 for(const code of [undefined,'not_ready','oauth_refreshing'])assert.equal(setupHelp(code),undefined)
 assert.equal(remoteSetupProblem(undefined,false,false),undefined)
 assert.equal(remoteSetupProblem({status:'online',health:{agentWorking:false},runs:[]},true,false),undefined)
})
test('confirmed disconnect, timeout and check failure are distinct',()=>{
 for(const status of ['offline','disconnected'])assert.equal(remoteSetupProblem({status},false,false),'disconnected')
 assert.equal(remoteSetupProblem({status:'revoked'},false,false),'connection_revoked')
 assert.equal(remoteSetupProblem({status:'expired'},false,false),'connection_expired')
 assert.equal(remoteSetupProblem({status:'online',relayProtocol:2,leaseExpiresAt:1},false,false),'connection_timeout')
 assert.equal(remoteSetupProblem(undefined,false,true),'check_failed')
})
test('failed task detection uses newest run, not historical failures',()=>{
 const failed={status:'failed',updated_at:10},running={status:'running',updated_at:20}
 assert.equal(remoteSetupProblem({status:'online',runs:[failed]},true,false),'task_failed')
 assert.equal(remoteSetupProblem({status:'online',runs:[failed,running]},true,false),undefined)
 for(const status of ['cancelled','rejected','completed'])assert.equal(remoteSetupProblem({status:'online',runs:[{status,updated_at:30}]},true,false),undefined)
 assert.equal(remoteSetupProblem({status:'online',health:{uploadFailures:1}},true,false),'uploads')
 assert.equal(remoteSetupProblem({status:'online',health:{agentWorking:true},runs:[failed]},true,false),undefined)
 assert.equal(remoteSetupProblem({status:'online',runs:[{status:'expired',expiredBeforeDispatch:true,updated_at:40}]},true,false),'task_not_dispatched')
})
test('each supported error provides actionable tutorial steps',()=>{
 for(const code of ['disconnected','connection_timeout','connection_revoked','connection_expired','key_missing','grant_missing','oauth_missing','oauth_reauthorize','oauth_runtime','model_unavailable','runtime_failed','check_failed','storage_unavailable','uploads','task_failed','task_not_dispatched','task_interrupted','task_expired','runtime_update_failed','capacity_unavailable','mount_unavailable','runtime_unavailable','ownership_conflict','authority_lost']){
  const guide=setupHelp(code);assert.ok(guide?.title);assert.ok(guide.steps.length>=2);assert.ok(['keys','status','queue'].includes(guide.action))
 }
})
