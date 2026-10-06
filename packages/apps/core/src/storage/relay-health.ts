import {agentStatusSchema,mergeAgentStatus,acknowledgedCatalogHash,type AgentStatus} from './agent-status.js'
import {validateContent} from './attachments.js'
import {z} from 'zod'
export const relayHealthSchema=z.object({status:agentStatusSchema.optional(),transport:z.enum(['websocket','https']).optional(),agentWorking:z.boolean().optional(),uploadFailures:z.number().int().min(0).max(1000000),retries:z.number().int().min(0).max(1000000),lastUploadAt:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),pendingCount:z.number().int().min(0).max(100),pendingBytes:z.number().int().min(0).max(2000000),pollLatencyMs:z.number().int().min(0).max(60000)}).strict()
import type {RelayOptions} from '@multiterm/rue-db/postgres'
export interface RelayHealth {status?:AgentStatus;transport?:'websocket'|'https';agentWorking?:boolean;uploadFailures:number;retries:number;lastUploadAt:number|null;pendingCount:number;pendingBytes:number;pollLatencyMs:number}
export function storedHealth(raw:string|null):RelayHealth|null{try{const value=raw?JSON.parse(raw):null;return value&&typeof value==='object'&&!Array.isArray(value)?value:null}catch{return null}}
export function summaryHealth(raw:string|null){const health=storedHealth(raw);if(!health?.status)return health;const {catalog,...status}=health.status;return {...health,status}}
export function healthCatalog(raw:string|null){const parsed=agentStatusSchema.safeParse(storedHealth(raw)?.status),status=parsed.success?parsed.data:undefined;return {piVersion:status?.piVersion??null,catalog:status?.catalog??null,catalogHash:acknowledgedCatalogHash(status)??null}}
export function mergeHealth(previous:string|null,input:Record<string,unknown>):Record<string,unknown>{return input.status?{...input,status:mergeAgentStatus(storedHealth(previous)?.status,agentStatusSchema.parse(input.status))}:input}
export const postgresRelayOptions:RelayOptions={validateContent,mergeHealth,summaryHealth,catalog:healthCatalog,catalogHash:raw=>acknowledgedCatalogHash(storedHealth(raw)?.status)}
