import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {RueApiError} from '@multiterm/rue-sdk'
import {readControlToken,readRelayControlSource,controlError,controlSubmissionUnconfirmed,waitForRuntimeRollout} from '../src/cli/control.ts'
import {keyPermissionsFor} from '../src/server/tenancy-key-api.ts'
test('CLI credentials require private owned files and never appear in error output',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rue-control-')),file=join(dir,'token')
 try{
  writeFileSync(file,'tnk_synthetic_test_secret\n',{mode:0o600});assert.equal(readControlToken(file),'tnk_synthetic_test_secret')
  chmodSync(file,0o644);assert.throws(()=>readControlToken(file),/token_file_invalid/);chmodSync(file,0o600)
  symlinkSync(file,join(dir,'link'));assert.throws(()=>readControlToken(join(dir,'link')),/token_file_invalid/)
  assert.throws(()=>readControlToken('relative'),/token_file_invalid/)
  assert.deepEqual(controlError(new RueApiError(409,JSON.stringify({error:'runtime_rollout_manager_upgrade_required',token:'tnk_do_not_print'}))),{error:'runtime_rollout_manager_upgrade_required',status:409})
  assert.equal(JSON.stringify(controlError(new RueApiError(503,'private response body'))).includes('private response body'),false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('relay discovery is explicitly read-only and bound to the expected API origin',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rue-self-control-')),file=join(dir,'relay.json')
 try{
  const value={origin:'https://rue.test',id:'term_'+'a'.repeat(32),token:'rue_terminal_'+'b'.repeat(43),outbox:[{private:'must not be returned'}]}
  writeFileSync(file,JSON.stringify(value),{mode:0o600})
  assert.deepEqual(readRelayControlSource(file,'https://rue.test'),{origin:value.origin,id:value.id,token:value.token})
  assert.throws(()=>readRelayControlSource(file,'https://other.test'),/relay_file_invalid/)
  assert.throws(()=>readControlToken(file),/token_file_invalid/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('rollout authority is separate from ordinary host/agent read grants',()=>{
 const id='12345678-1234-4234-8234-123456789012'
 assert.deepEqual(keyPermissionsFor('POST',`/runtime-rollouts/hosts/${id}`),['rue:runtimes:deploy','rue:agents:execute'])
 assert.deepEqual(keyPermissionsFor('GET',`/runtime-rollouts/${id}`),['rue:runtimes:read'])
 assert.deepEqual(keyPermissionsFor('POST',`/runtime-rollouts/${id}/resolve`),['rue:runtimes:deploy','rue:agents:execute'])
 assert.equal(keyPermissionsFor('POST','/runtime-rollouts/arbitrary-shell'),undefined)
})
test('local validation is not reported as an uncertain API submission',()=>{
 assert.equal(controlSubmissionUnconfirmed(false,Error('rue_control_agent_wait_not_allowed')),false)
 assert.equal(controlSubmissionUnconfirmed(true,new RueApiError(409,'{}')),false)
 assert.equal(controlSubmissionUnconfirmed(true,new RueApiError(503,'{}')),true)
 assert.equal(controlSubmissionUnconfirmed(true,Error('connection lost')),true)
})
test('waiting is read-only, timeout is not cancellation, and failure is terminal',async()=>{
 let reads=0
 const read=async()=>{reads++;return {phase:'preflight'} as any}
 await assert.rejects(waitForRuntimeRollout(read,0),/timed_out/);assert.equal(reads,1)
 const abort=new AbortController();abort.abort();await assert.rejects(waitForRuntimeRollout(read,1000,abort.signal),/cancelled/);assert.equal(reads,1)
 assert.equal((await waitForRuntimeRollout(async()=>({phase:'failed'}) as any,1000)).phase,'failed')
})
