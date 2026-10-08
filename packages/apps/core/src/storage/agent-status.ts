import {z} from 'zod'
import {createHash} from 'node:crypto'
const count=z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER)
const text=(max:number)=>z.string().max(max).regex(/^[^\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]*$/)
const id=text(128).min(1)
const catalog=z.object({providers:z.array(z.object({id:id.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),name:text(128),credentialMode:z.enum(['api_key','oauth','unsupported']),models:z.array(z.object({id,name:text(128),contextWindow:count.int()}).strict()).max(4096)}).strict()).max(128),truncated:z.boolean()}).strict().refine(value=>value.providers.reduce((n,p)=>n+p.models.length,0)<=4096&&Buffer.byteLength(JSON.stringify(value))<=512*1024)
export const agentStatusSchema=z.object({
 git:z.object({branch:text(256).nullable(),remote:text(256).nullable(),localBranches:z.array(text(256).min(1)).max(50),truncated:z.boolean()}).strict().nullable().optional(),
 catalogHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 piVersion:z.string().max(64).regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/).nullable().optional(),catalog:catalog.optional(),
 version:z.literal(1),cwd:text(1024),branch:text(256).nullable(),state:z.enum(['idle','working','compacting']),provider:text(128).nullable(),model:text(128).nullable(),thinking:text(32).nullable(),
 context:z.object({tokens:count.nullable(),window:count.nullable(),percent:count.nullable()}).strict(),
 usage:z.object({input:count,output:count,cacheRead:count,cacheWrite:count,costUsd:count}).strict(),
 cacheHitPercent:z.number().finite().min(0).max(100).nullable(),subscription:z.boolean().nullable(),autoCompaction:z.boolean().nullable(),
}).strict()
export type AgentStatus=z.infer<typeof agentStatusSchema>
export function acknowledgedCatalogHash(status:AgentStatus|undefined):string|undefined{
 if(status?.catalog&&status.catalogHash&&createHash('sha256').update(JSON.stringify(status.catalog)).digest('hex')===status.catalogHash)return status.catalogHash
}
/** A digest acknowledgment saves repeated catalog uploads; never preserve other stale status fields. */
export function mergeAgentStatus(previous:unknown,next:AgentStatus):AgentStatus{
 if(next.catalog)return {...next,catalogHash:createHash('sha256').update(JSON.stringify(next.catalog)).digest('hex')}
 const old=agentStatusSchema.safeParse(previous)
 if(next.catalogHash&&old.success&&old.data.catalog&&acknowledgedCatalogHash(old.data)===next.catalogHash&&old.data.piVersion===next.piVersion)return {...next,catalog:old.data.catalog}
 const {catalogHash,...withoutUnacknowledgedCatalog}=next;return withoutUnacknowledgedCatalog
}
