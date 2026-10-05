import type {Database} from 'better-sqlite3'
/** An uncertain compaction holds its original runtime until explicit fencing.
 * Expiry alone must not allow another prompt to race an unacknowledged summary. */
export function compactionHoldsRuntime(db:Database,connectionId:string,runningOnly=false){
 return Boolean(db.prepare(`SELECT 1 FROM managed_compactions c JOIN managed_agents a ON a.id=c.agent_id
  WHERE a.connection_id=? AND c.revision=a.grant_revision AND c.generation=a.grant_generation AND c.boot=a.grant_boot
  AND c.status IN (${runningOnly?"'running','uncertain'":"'queued','assigned','running','uncertain'"}) LIMIT 1`).get(connectionId))
}
