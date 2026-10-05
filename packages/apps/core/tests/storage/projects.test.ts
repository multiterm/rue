import {randomUUID} from 'node:crypto'
import {afterEach,expect,test,vi} from 'vitest'
import {openDatabase} from '../../src/storage/db.js'
import {createProjectBinding,projectCredential,updateProjectProof,projectDeadline} from '../../src/storage/projects.js'
import {createWorker,connectWorker,validateWorker} from '../../src/storage/workers.js'
import {createManagedAgent,managedGrant} from '../../src/storage/managed-agents.js'
import {authenticateTerminalConnection} from '../../src/storage/terminal-pairing.js'
const dbs:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{dbs.splice(0).forEach(db=>db.close());vi.unstubAllEnvs()})
function setup(){
 vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,7).toString('base64'))
 const db=openDatabase(':memory:');dbs.push(db)
 const id=randomUUID(),token='tnk_'+'a'.repeat(43),origin='https://tenancy.test',claims={id:'key_one',organizationId:'self',projectId:'owner',owner:{type:'self' as const,subject:'owner'},service:'rue' as const,scopes:['rue:hosts:enroll','rue:agents:execute'],expiresAt:100000}
 const binding=createProjectBinding(db,'owner',id,origin,token,claims,1000,1000)
 return {db,id,token,origin,claims,binding}
}
test('delegated authority is encrypted and bound to the verified owner, key and origin',()=>{
 const {db,id,token,origin,claims,binding}=setup()
 expect(createProjectBinding(db,'owner',id,origin,token,claims,1001,1001)).toEqual(binding)
 expect(()=>createProjectBinding(db,'other',id,origin,token,claims,1001,1001)).toThrow('project_key_scope_invalid')
 expect(()=>createProjectBinding(db,'owner',randomUUID(),origin,token,{...claims,scopes:['rue:hosts:read']},1001,1001)).toThrow('project_key_scope_invalid')
 expect(()=>projectCredential(db,id,'https://other.test')).toThrow('project_binding_fenced')
 expect(JSON.stringify(db.prepare('SELECT * FROM project_bindings').all())).not.toContain(token)
 expect(projectCredential(db,id,origin).token).toBe(token)
 vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,8).toString('base64'));expect(()=>projectCredential(db,id,origin)).toThrow()
})
test('Tenancy authority caps worker and terminal leases and revocation fences descendants and late replies',()=>{
 const {db,id,claims}=setup(),w=createWorker(db,'owner','Bound host',randomUUID(),1001,id),instance=randomUUID()
 const lease=connectWorker(db,w.worker.id,w.secret!,instance,1002);expect(lease.expiresAt).toBe(46000)
 const a=createManagedAgent(db,'owner',{workerId:w.worker.id,requestId:randomUUID(),name:'Bound agent',acknowledgeExecution:true,config:{provider:'openai',model:'gpt-4.1-mini',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}},1003).agent
 const g=managedGrant(db,{id:w.worker.id,secret:w.secret!,instance,generation:lease.generation},a.id,1,1004)
 expect(authenticateTerminalConnection(db,g.token,g.id,1005).expiresAt).toBe(46000)
 expect(()=>validateWorker(db,w.worker.id,w.secret!,instance,lease.generation,46000)).toThrow('worker_project_fenced')
 expect(updateProjectProof(db,id,1,undefined,2000,2001)).toBe(false)
 expect(()=>authenticateTerminalConnection(db,g.token,g.id,2002)).toThrow()
 expect(()=>connectWorker(db,w.worker.id,w.secret!,instance,2002)).toThrow('worker_project_fenced')
 expect(()=>updateProjectProof(db,id,1,claims,1500,2003)).toThrow('project_binding_fenced')
 expect(db.prepare('SELECT encrypted_key FROM project_bindings WHERE id=?').get(id)).toEqual({encrypted_key:null})
})
test('request-start deadlines cannot be extended by late, unavailable or owner-changing proofs',()=>{
 const {db,id,claims}=setup()
 expect(updateProjectProof(db,id,1,claims,10000,18000)).toBe(true);expect(projectDeadline(db,id,18000)).toBe(55000);expect(projectDeadline(db,id,9000)).toBe(0)
 expect(updateProjectProof(db,id,1,claims,9000,18001)).toBe(true);expect(projectDeadline(db,id,18001)).toBe(55000)
 expect(()=>updateProjectProof(db,id,1,claims,10000,55000)).toThrow('project_binding_fenced')
 expect(updateProjectProof(db,id,1,{...claims,owner:{type:'self',subject:'other'}},18002,18003)).toBe(false);expect(projectDeadline(db,id,18004)).toBe(0)
})
