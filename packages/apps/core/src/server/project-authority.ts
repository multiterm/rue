import type {Database} from 'better-sqlite3'
import {asProjectClaims,type ProjectVerifier} from './tenancy-verifier.js'
import {ProjectError,type ProjectAuthorityRepository} from '@multiterm/rue-db'
import {createSqliteProjectAuthorityRepository} from '../storage/sqlite-project-authority.js'
import {workerProjectBinding,WorkerError} from '../storage/workers.js'
export class ProjectAuthority {
 private pending=new Map<string,Promise<void>>()
 readonly repository:ProjectAuthorityRepository
 constructor(source:Database|ProjectAuthorityRepository,readonly verifier:ProjectVerifier){this.repository='prepare' in source?createSqliteProjectAuthorityRepository(source):source}
 async refresh(id:string){
  const previous=this.pending.get(id);if(previous)return previous
  const task=(async()=>{
   const {revision,token}=await this.repository.credential(id,this.verifier.origin),started=Date.now()
   const key=await this.verifier.verifyKey(token)
   const claims=key?asProjectClaims(key):undefined
   if(!await this.repository.updateProof(id,revision,claims,started))throw new ProjectError(401,'project_binding_fenced')
  })()
  this.pending.set(id,task)
  try{await task}finally{if(this.pending.get(id)===task)this.pending.delete(id)}
 }
 async owned(id:string,owner:string){
  if(await this.repository.bindingOwner(id)!==owner)throw new ProjectError(404,'project_binding_not_found')
  await this.refresh(id)
 }
 async ownerWorker(id:string,owner:string){
  const row=await this.repository.ownedWorkerBinding(id,owner)
  if(!row)throw new WorkerError(404,'worker_not_found')
  if(row.bindingId)await this.owned(row.bindingId,owner)
 }
}
export async function refreshWorkerProject(db:Database,authority:ProjectAuthority|undefined,id:string,token:string){
 const binding=workerProjectBinding(db,id,token) // Authenticate before any verifier I/O.
 if(!binding)return
 if(!authority)throw new WorkerError(401,'worker_project_fenced')
 try{await authority.refresh(binding)}catch(error){if(error instanceof ProjectError)throw new WorkerError(401,'worker_project_fenced');throw error}
}
export async function refreshOwnedWorkerProject(db:Database,authority:ProjectAuthority|undefined,id:string,owner:string){
 if(authority)return authority.ownerWorker(id,owner)
 const row=await createSqliteProjectAuthorityRepository(db).ownedWorkerBinding(id,owner)
 if(!row)throw new WorkerError(404,'worker_not_found')
 if(row.bindingId)throw new WorkerError(401,'worker_project_fenced')
}
export function fenceProjectAuthorityOnBoot(source:Database|ProjectAuthorityRepository){
 return ('prepare' in source?createSqliteProjectAuthorityRepository(source):source).fenceOnBoot()
}
