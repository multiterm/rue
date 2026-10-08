import type {Database} from 'better-sqlite3'
import {ProjectError,type ProjectAuthorityRepository} from '@multiterm/rue-db'
import {projectBinding,projectCredential,updateProjectProof} from './projects.js'
/** Temporary same-database adapter. Never pass async callbacks to SQLite transactions. */
export function createSqliteProjectAuthorityRepository(db:Database):ProjectAuthorityRepository{
 return {
  async bindingOwner(id){return projectBinding(db,id)?.owner_subject},
  async credential(id,origin){const {row,token}=projectCredential(db,id,origin);return {revision:row.revision,token}},
  async updateProof(id,revision,claims,started,now){return updateProjectProof(db,id,revision,claims,started,now)},
  async ownedWorkerBinding(id,owner){
   const row=db.prepare('SELECT project_binding_id FROM workers WHERE id=? AND owner_subject=?').get(id,owner) as {project_binding_id:string|null}|undefined
   return row?{bindingId:row.project_binding_id}:undefined
  },
  async fenceOnBoot(){db.transaction(()=>{
   const unsafe=db.prepare('SELECT count(*) AS n FROM (SELECT revision AS value FROM project_bindings WHERE revoked_at IS NULL UNION ALL SELECT generation FROM workers WHERE project_binding_id IS NOT NULL AND lease_expires_at IS NOT NULL) WHERE value<0 OR value>=?').get(Number.MAX_SAFE_INTEGER) as {n:number}
   if(unsafe.n)throw new ProjectError(409,'project_counter_exhausted')
   db.prepare('UPDATE project_bindings SET authorized_until=0,revision=revision+1 WHERE revoked_at IS NULL').run()
   db.prepare('UPDATE workers SET lease_expires_at=NULL,instance_id=NULL,generation=generation+1,health=NULL WHERE project_binding_id IS NOT NULL AND lease_expires_at IS NOT NULL').run()
  }).immediate()},
 }
}
