import {createHash} from 'node:crypto'
import type {Database} from 'better-sqlite3'
import type {ProjectClaims} from '../server/tenancy-verifier.js'
import {keyResourceOwner} from '../server/tenancy-keys.js'
import {encryptCredential,decryptCredential} from './agent-settings.js'
export const PROJECT_AUTHORITY_MS=45000
import {ProjectError} from '@multiterm/rue-db'
export {ProjectError}
interface Row {id:string;owner_subject:string;tenancy_origin:string;organization_id:string;project_id:string;key_id:string;key_hash:string;encrypted_key:string|null;scopes:string;expires_at:number;revision:number;created_at:number;revoked_at:number|null;verified_at:number;authorized_until:number}
export const projectBinding=(db:Database,id:string)=>db.prepare('SELECT * FROM project_bindings WHERE id=?').get(id) as Row|undefined
const fingerprint=(token:string)=>createHash('sha256').update(token).digest('hex')
function permitted(claims:ProjectClaims){return claims.service==='rue'&&['rue:hosts:enroll','rue:agents:execute'].every(scope=>claims.scopes.includes(scope))}
/** Internal enrollment delegation only. Tenancy is the sole public key authority. */
export function createProjectBinding(db:Database,owner:string,id:string,origin:string,token:string,claims:ProjectClaims,started:number,now=Date.now()){
 if(!permitted(claims)||keyResourceOwner({owner:claims.owner})!==owner||claims.expiresAt<=now||started>now||started+PROJECT_AUTHORITY_MS<=now)throw new ProjectError(401,'project_key_scope_invalid')
 return db.transaction(()=>{
  const existing=projectBinding(db,id)
  if(existing){if(existing.owner_subject!==owner)throw new ProjectError(404,'project_binding_not_found');if(existing.tenancy_origin!==origin||existing.key_hash!==fingerprint(token)||existing.key_id!==claims.id||existing.revoked_at!==null)throw new ProjectError(409,'project_binding_conflict');return {id:existing.id,revision:existing.revision}}
  if((db.prepare('SELECT count(*) AS n FROM project_bindings WHERE owner_subject=?').get(owner) as {n:number}).n>=256)throw new ProjectError(429,'project_binding_limit')
  const encrypted=encryptCredential(db,[owner,'project-binding',id,origin],token)
  db.prepare('INSERT INTO project_bindings(id,owner_subject,tenancy_origin,organization_id,project_id,key_id,key_hash,encrypted_key,scopes,expires_at,created_at,verified_at,authorized_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,origin,claims.organizationId,claims.projectId,claims.id,fingerprint(token),encrypted,JSON.stringify(claims.scopes),claims.expiresAt,now,started,Math.min(started+PROJECT_AUTHORITY_MS,claims.expiresAt))
  return {id,revision:1}
 }).immediate()
}
export function projectDeadline(db:Database,id:string|null|undefined,now=Date.now()){
 if(!id)return Infinity
 const r=projectBinding(db,id)
 return r&&r.revoked_at===null&&r.encrypted_key&&now>=r.verified_at?Math.min(r.authorized_until,r.expires_at):0
}
export function projectCredential(db:Database,id:string,origin:string){
 const row=projectBinding(db,id)
 if(!row||row.tenancy_origin!==origin||row.revoked_at!==null||!row.encrypted_key)throw new ProjectError(401,'project_binding_fenced')
 return {row,token:decryptCredential(db,[row.owner_subject,'project-binding',id,origin],row.encrypted_key)}
}
function fence(db:Database,id:string){
 db.prepare('UPDATE project_bindings SET authorized_until=0 WHERE id=?').run(id)
 db.prepare('UPDATE workers SET lease_expires_at=NULL,instance_id=NULL,generation=generation+1,health=NULL WHERE project_binding_id=? AND lease_expires_at IS NOT NULL').run(id)
}
export function updateProjectProof(db:Database,id:string,revision:number,claims:ProjectClaims|undefined,started:number,now=Date.now()){
 return db.transaction(()=>{
  const row=projectBinding(db,id)
  if(!row||row.revision!==revision||row.revoked_at!==null)throw new ProjectError(401,'project_binding_fenced')
  if(!claims||keyResourceOwner({owner:claims.owner})!==row.owner_subject||claims.id!==row.key_id||claims.organizationId!==row.organization_id||claims.projectId!==row.project_id||!permitted(claims)||claims.expiresAt<=now){fence(db,id);db.prepare('UPDATE project_bindings SET revoked_at=?,encrypted_key=NULL,revision=revision+1 WHERE id=?').run(now,id);return false}
  if(started>now||started+PROJECT_AUTHORITY_MS<=now)throw new ProjectError(401,'project_binding_fenced')
  if(started>=row.verified_at)db.prepare('UPDATE project_bindings SET verified_at=?,authorized_until=?,expires_at=?,scopes=? WHERE id=?').run(started,Math.min(started+PROJECT_AUTHORITY_MS,claims.expiresAt),claims.expiresAt,JSON.stringify(claims.scopes),id)
  return true
 }).immediate()
}
