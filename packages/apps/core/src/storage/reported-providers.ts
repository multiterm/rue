import type {Database} from 'better-sqlite3'
import {agentStatusSchema} from './agent-status.js'
/** Account credential choices come from owner-bound runtime reports, never another tenant's catalog. */
export function reportedProviders(db:Database,owner:string){
 const providers=new Map<string,{id:string;name:string;auth:'api_key'|'oauth'}>()
 const rows=db.prepare('SELECT relay_health FROM terminal_connections WHERE owner_subject=? AND revoked_at IS NULL AND relay_health IS NOT NULL ORDER BY last_seen_at DESC LIMIT 64').all(owner) as Array<{relay_health:string}>
 for(const row of rows){try{const result=agentStatusSchema.safeParse(JSON.parse(row.relay_health).status);if(!result.success)continue;for(const p of result.data.catalog?.providers??[]){if(p.credentialMode==='unsupported'||(p.credentialMode==='oauth'&&p.id!=='openai-codex')||providers.has(p.id))continue;providers.set(p.id,{id:p.id,name:p.name,auth:p.credentialMode})}}catch{/* Invalid historical telemetry is not a credential authority. */}}
 return [...providers.values()]
}
