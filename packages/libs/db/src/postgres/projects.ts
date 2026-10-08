import {createHash} from 'node:crypto'
import {and,count,eq,isNull,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {projectBindings,workers} from './schema.js'
import {lockPostgresOwner} from './owner-lock.js'
import {ProjectError,type ProjectClaims,type ProjectAuthorityRepository} from '../project-authority-repository.js'
export const PROJECT_AUTHORITY_MS=45_000
export interface CredentialCodec {encrypt(scope:string[],value:string):string;decrypt(scope:string[],value:string):string}
const ownerOf=(claims:ProjectClaims)=>claims.owner.type==='self'?claims.owner.subject:`tenancy:project:${claims.owner.organizationId}:${claims.owner.projectId}`
const permitted=(claims:ProjectClaims)=>claims.service==='rue'&&['rue:hosts:enroll','rue:agents:execute'].every(scope=>claims.scopes.includes(scope))
const hash=(token:string)=>createHash('sha256').update(token).digest('hex')
const fenced=():never=>{throw new ProjectError(401,'project_binding_fenced')}
function fresh(started:number,now:number){return Number.isSafeInteger(started)&&Number.isSafeInteger(now)&&started>=0&&now>=started&&now<started+PROJECT_AUTHORITY_MS&&started<=Number.MAX_SAFE_INTEGER-PROJECT_AUTHORITY_MS}
/** Only authenticated Tenancy verifier results belong here, never client claims.
 * Verification/network I/O and credential encryption are not SQL operations.
 * Owner lock -> binding row -> worker rows matches the worker repository. */
export function createPostgresProjectRepository(db:RuePostgresDatabase,codec:CredentialCodec){
 const ownedWorkerBinding:ProjectAuthorityRepository['ownedWorkerBinding']=async(id,owner)=>{
  const [row]=await db.select({bindingId:workers.projectBindingId}).from(workers).where(and(eq(workers.id,id),eq(workers.ownerSubject,owner)));return row
 }
 const updateProof:ProjectAuthorityRepository['updateProof']=async(id,revision,claims,started,at)=>db.transaction(async tx=>{
  const [initial]=await tx.select({owner:projectBindings.ownerSubject}).from(projectBindings).where(eq(projectBindings.id,id));if(!initial)return fenced()
  await lockPostgresOwner(tx,initial.owner)
  const [row]=await tx.select().from(projectBindings).where(eq(projectBindings.id,id)).for('update')
  if(!row||row.ownerSubject!==initial.owner||row.revision!==revision||row.revokedAt!==null)return fenced()
  const now=at??Date.now()
  // Explicit negative authority always fences, even if its request started earlier.
  if(!claims||ownerOf(claims)!==row.ownerSubject||claims.id!==row.keyId||claims.organizationId!==row.organizationId||claims.projectId!==row.projectId||!permitted(claims)||!Number.isSafeInteger(claims.expiresAt)||claims.expiresAt<=now){
   if(row.revision>=Number.MAX_SAFE_INTEGER)throw new ProjectError(409,'project_counter_exhausted')
   const [unsafe]=await tx.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM public.workers WHERE project_binding_id=${id} AND lease_expires_at IS NOT NULL AND (generation<0 OR generation>=${Number.MAX_SAFE_INTEGER})`)
   if(unsafe!.n)throw new ProjectError(409,'project_counter_exhausted')
   await tx.update(projectBindings).set({authorizedUntil:0,revokedAt:now,encryptedKey:null,revision:row.revision+1}).where(eq(projectBindings.id,id))
   await tx.update(workers).set({leaseExpiresAt:null,instanceId:null,generation:sql`${workers.generation}+1`,health:null}).where(and(eq(workers.projectBindingId,id),sql`${workers.leaseExpiresAt} IS NOT NULL`))
   return false
  }
  if(!fresh(started,now))return fenced()
  if(started<row.verifiedAt)return true
  await tx.update(projectBindings).set({verifiedAt:started,authorizedUntil:Math.min(started+PROJECT_AUTHORITY_MS,claims.expiresAt),expiresAt:claims.expiresAt,scopes:JSON.stringify(claims.scopes)}).where(eq(projectBindings.id,id))
  return true
 })
 return {
  async create(owner:string,id:string,origin:string,token:string,claims:ProjectClaims,started:number,at?:number){
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner)
    const [existing]=await tx.select().from(projectBindings).where(eq(projectBindings.id,id)).for('update')
    const now=at??Date.now()
    if(!fresh(started,now)||!permitted(claims)||ownerOf(claims)!==owner||!Number.isSafeInteger(claims.expiresAt)||claims.expiresAt<=now)throw new ProjectError(401,'project_key_scope_invalid')
    if(existing){
     if(existing.ownerSubject!==owner)throw new ProjectError(404,'project_binding_not_found')
     if(existing.tenancyOrigin!==origin||existing.keyHash!==hash(token)||existing.keyId!==claims.id||existing.organizationId!==claims.organizationId||existing.projectId!==claims.projectId||existing.revokedAt!==null)throw new ProjectError(409,'project_binding_conflict')
     return {id:existing.id,revision:existing.revision}
    }
    const [total]=await tx.select({n:count()}).from(projectBindings).where(eq(projectBindings.ownerSubject,owner));if(total!.n>=256)throw new ProjectError(429,'project_binding_limit')
    const encryptedKey=codec.encrypt([owner,'project-binding',id,origin],token)
    // Different owners can race the same caller-supplied ID; do not expose SQL errors.
    const inserted=await tx.insert(projectBindings).values({id,ownerSubject:owner,tenancyOrigin:origin,organizationId:claims.organizationId,projectId:claims.projectId,keyId:claims.id,keyHash:hash(token),encryptedKey,scopes:JSON.stringify(claims.scopes),expiresAt:claims.expiresAt,createdAt:now,verifiedAt:started,authorizedUntil:Math.min(started+PROJECT_AUTHORITY_MS,claims.expiresAt)}).onConflictDoNothing({target:projectBindings.id}).returning({id:projectBindings.id,revision:projectBindings.revision})
    if(!inserted.length)throw new ProjectError(409,'project_binding_conflict')
    return inserted[0]!
   })
  },
  async bindingOwner(id:string){const [row]=await db.select({owner:projectBindings.ownerSubject}).from(projectBindings).where(eq(projectBindings.id,id));return row?.owner},
  async credential(id:string,origin:string){
   const [row]=await db.select().from(projectBindings).where(and(eq(projectBindings.id,id),eq(projectBindings.tenancyOrigin,origin),isNull(projectBindings.revokedAt)))
   if(!row?.encryptedKey)return fenced()
   return {revision:row.revision,token:codec.decrypt([row.ownerSubject,'project-binding',id,origin],row.encryptedKey)}
  },
  ownedWorkerBinding,updateProof,
  /** Single-API startup only. Revision fencing rejects verification begun before boot. */
  async fenceOnBoot(){await db.transaction(async tx=>{
   await tx.execute(sql`LOCK TABLE public.project_bindings,public.workers IN EXCLUSIVE MODE`)
   const [unsafe]=await tx.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM (
    SELECT revision AS n FROM public.project_bindings WHERE revoked_at IS NULL
    UNION ALL SELECT generation FROM public.workers WHERE project_binding_id IS NOT NULL AND lease_expires_at IS NOT NULL
   ) counters WHERE n<0 OR n>=${Number.MAX_SAFE_INTEGER}`)
   if(unsafe!.n)throw new ProjectError(409,'project_counter_exhausted')
   await tx.update(projectBindings).set({authorizedUntil:0,revision:sql`${projectBindings.revision}+1`}).where(isNull(projectBindings.revokedAt))
   await tx.update(workers).set({leaseExpiresAt:null,instanceId:null,generation:sql`${workers.generation}+1`,health:null}).where(sql`${workers.projectBindingId} IS NOT NULL AND ${workers.leaseExpiresAt} IS NOT NULL`)
  })},
 } satisfies ProjectAuthorityRepository&{create:unknown}
}
