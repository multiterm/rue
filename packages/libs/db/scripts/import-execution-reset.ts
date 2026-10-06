import {sql} from 'drizzle-orm'
import {getTableConfig} from 'drizzle-orm/pg-core'
import {postgresSchema} from '../src/postgres/schema.js'
import type {RuePostgresDatabase} from '../src/postgres/client.js'

/** Operator rehearsal policy v1. Refuse work needing a recovery decision; never
 * cancel, replay, drop, or pretend to have physically stopped that work.
 * Must run inside the import transaction. LOCK fails outside a transaction.
 * Intentionally restricted to disposable databases, not a live cutover command. */
export async function resetImportedExecutionState(tx:Pick<RuePostgresDatabase,'execute'>,expectedDatabase:string,now=Date.now()){
 if(!/^rue_(rehearsal|restore)_[a-f0-9]{32}$/.test(expectedDatabase))throw Error('import_reset_disposable_database_required')
 return applyImportedExecutionHold(tx,expectedDatabase,now)
}
/** Separate operator cutover entry point. Rehearsal's disposable-name guard is
 * unchanged; caller must have stopped writers and hold the coordinator lock. */
export async function resetCutoverExecutionState(tx:Pick<RuePostgresDatabase,'execute'>,expectedDatabase:string,acknowledgeStoppedWriters:boolean,now=Date.now()){
 if(acknowledgeStoppedWriters!==true||!/^rue_(?!rehearsal_|restore_)[a-z][a-z0-9_]{0,55}$/.test(expectedDatabase))throw Error('import_reset_cutover_confirmation_required')
 return applyImportedExecutionHold(tx,expectedDatabase,now)
}
async function applyImportedExecutionHold(tx:Pick<RuePostgresDatabase,'execute'>,expectedDatabase:string,now:number){
 if(!Number.isSafeInteger(now)||now<1)throw Error('import_reset_time_invalid')
 const [identity]=await tx.execute<{name:string}>(sql`SELECT current_database() AS name`)
 if(identity?.name!==expectedDatabase)throw Error('import_reset_database_identity_mismatch')
 const names=Object.values(postgresSchema).map(table=>getTableConfig(table).name).sort()
 await tx.execute(sql`LOCK TABLE ${sql.join(names.map(name=>sql`${sql.identifier('public')}.${sql.identifier(name)}`),sql`, `)} IN ACCESS EXCLUSIVE MODE`)
 await tx.execute(sql`SET LOCAL search_path=pg_catalog,public`)
 const blockers=await tx.execute<{kind:string;n:number}>(sql`
  SELECT 'terminal_commands' AS kind,count(*)::int AS n FROM terminal_commands WHERE status NOT IN ('completed','failed','cancelled','expired','interrupted')
  UNION ALL SELECT 'managed_operations',count(*)::int FROM managed_operations WHERE status NOT IN ('succeeded','superseded')
  UNION ALL SELECT 'managed_compactions',count(*)::int FROM managed_compactions WHERE status NOT IN ('succeeded','failed','cancelled')
  UNION ALL SELECT 'runtime_rollouts',count(*)::int FROM runtime_rollouts WHERE phase NOT IN ('succeeded','failed')
  UNION ALL SELECT 'agent_updates_or_purges',count(*)::int FROM managed_agents WHERE (runtime_update_state IS NOT NULL AND runtime_update_state NOT IN ('updated','rolled_back','cancelled','failed')) OR (purge_requested_at IS NOT NULL AND purged_at IS NULL)
  UNION ALL SELECT 'oauth_refresh',count(*)::int FROM provider_oauth_credentials WHERE state='refreshing' OR refresh_nonce IS NOT NULL OR refresh_started_at IS NOT NULL
  UNION ALL SELECT 'push_deliveries',count(*)::int FROM push_deliveries WHERE state NOT IN ('sent','failed') OR lease_id IS NOT NULL OR lease_until IS NOT NULL
  UNION ALL SELECT 'scheduled_tasks',count(*)::int FROM scheduled_tasks`)
 const blocked=blockers.filter(row=>row.n>0)
 if(blocked.length)throw new ImportResetBlocked(blocked)
 // Generation/revision counters must remain exactly representable by existing clients.
 const [unsafe]=await tx.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM (
  SELECT revision AS value FROM workers UNION ALL SELECT generation FROM workers
  UNION ALL SELECT revision FROM managed_agents UNION ALL SELECT settings_revision FROM terminal_connections
  UNION ALL SELECT revision FROM runtime_control_grants UNION ALL SELECT revision FROM project_bindings
 ) counters WHERE value<0 OR value>=${Number.MAX_SAFE_INTEGER}`)
 if(unsafe?.n)throw Error('import_reset_unsafe_counter')
 const workers=await tx.execute(sql`WITH changed AS (
  UPDATE workers SET desired='draining',generation=generation+1,revision=revision+1,instance_id=NULL,lease_expires_at=NULL,last_seen_at=NULL,health=NULL
  WHERE desired<>'draining' OR instance_id IS NOT NULL OR lease_expires_at IS NOT NULL OR last_seen_at IS NOT NULL OR health IS NOT NULL RETURNING id,revision
 ) INSERT INTO worker_audit(id,worker_id,action,revision,created_at)
 SELECT gen_random_uuid()::text,id,'migration_hold',revision,${now} FROM changed RETURNING worker_id`)
 const agents=await tx.execute(sql`UPDATE managed_agents SET desired=CASE WHEN desired='destroyed' THEN desired ELSE 'stopped' END,
  revision=revision+1,grant_revision=NULL,grant_generation=NULL,grant_boot=NULL,encrypted_grant=NULL,
  observed=CASE WHEN purged_at IS NULL THEN 'pending' ELSE observed END,observed_revision=NULL,observed_generation=NULL,observed_at=NULL,
  error=CASE WHEN purged_at IS NULL THEN COALESCE(error,'migration_reconciliation_required') ELSE error END
  WHERE desired='running' OR grant_revision IS NOT NULL OR grant_generation IS NOT NULL OR grant_boot IS NOT NULL OR encrypted_grant IS NOT NULL
   OR observed_revision IS NOT NULL OR observed_generation IS NOT NULL OR observed_at IS NOT NULL OR (observed='running' AND purged_at IS NULL) RETURNING id`)
 const connections=await tx.execute(sql`UPDATE terminal_connections SET expires_at=0,remote_enabled=0,settings_revision=settings_revision+1,
  instance_id=NULL,lease_expires_at=NULL,last_seen_at=NULL,relay_health=NULL
  WHERE expires_at<>0 OR remote_enabled<>0 OR instance_id IS NOT NULL OR lease_expires_at IS NOT NULL OR last_seen_at IS NOT NULL OR relay_health IS NOT NULL RETURNING id`)
 const delegations=await tx.execute(sql`WITH changed AS (
  UPDATE runtime_control_grants SET enabled=0,expires_at=0,revision=revision+1,updated_at=${now}
  WHERE enabled<>0 OR expires_at<>0 RETURNING agent_id,owner_subject,worker_id,revision
 ) INSERT INTO runtime_control_audit(id,owner_subject,agent_id,worker_id,grant_revision,action,created_at)
 SELECT gen_random_uuid()::text,owner_subject,agent_id,worker_id,revision,'migration_revoked',${now} FROM changed RETURNING agent_id`)
 const proofs=await tx.execute(sql`UPDATE project_bindings SET authorized_until=0,verified_at=0,revision=revision+1 WHERE authorized_until<>0 OR verified_at<>0 RETURNING id`)
 const devicePairings=await tx.execute(sql`UPDATE device_pairings SET expires_at=0 WHERE expires_at<>0 RETURNING id`)
 const terminalPairings=await tx.execute(sql`UPDATE terminal_pairing_requests SET expires_at=0 WHERE expires_at<>0 RETURNING id`)
 const oauthIntents=await tx.execute(sql`UPDATE oauth_login_intents SET expires_at=0 WHERE expires_at<>0 RETURNING id`)
 return {policyVersion:1 as const,executionHeld:true as const,cutoverReady:false as const,changed:{workers:workers.length,agents:agents.length,connections:connections.length,delegations:delegations.length,projectProofs:proofs.length,devicePairings:devicePairings.length,terminalPairings:terminalPairings.length,oauthIntents:oauthIntents.length}}
}
/** Fixed categories/counts only; no command bodies, tokens or database errors. */
export class ImportResetBlocked extends Error{
 constructor(readonly blockers:Array<{kind:string;n:number}>){super('import_reset_unresolved_execution');this.name='ImportResetBlocked'}
}
