import {DatabaseSync} from 'node:sqlite'
import {lstatSync,existsSync,openSync,readSync,closeSync,constants} from 'node:fs'
import {isAbsolute,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {MIGRATIONS} from '../../../apps/core/src/storage/schema.ts'
const quote=name=>'"'+name.replaceAll('"','""')+'"'
const tableNames=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name)
const columns=(db,name)=>db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(({name,type,notnull,dflt_value,pk})=>({name,type,notnull,dflt_value,pk}))
/** A preflight, NOT an importer or permission to cut over. No row contents leave this function. */
export function auditSqliteBackup(path){
 if(!isAbsolute(path))throw Error('backup_absolute_path_required')
 const stat=lstatSync(path)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0)throw Error('backup_private_owned_file_required')
 if(existsSync(path+'-wal')||existsSync(path+'-shm'))throw Error('standalone_consistent_backup_required')
 // WAL-mode headers can create sidecars even for read-only connections. Normalize
 // a NEW backup to journal_mode=DELETE when creating it, never during this audit.
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),header=Buffer.alloc(20)
 try{if(readSync(fd,header,0,20,0)!==20||header.subarray(0,16).toString()!=='SQLite format 3\u0000')throw Error('backup_header_invalid')
  if(header[18]!==1||header[19]!==1)throw Error('standalone_delete_journal_backup_required')
 }finally{closeSync(fd)}
 const canonical=new DatabaseSync(':memory:');let db,reading=false
 try{
  for(const migration of MIGRATIONS)canonical.exec(migration.sql)
  db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA query_only=ON; BEGIN');reading=true
  if(db.prepare('PRAGMA integrity_check').all().some(row=>Object.values(row)[0]!=='ok'))throw Error('backup_integrity_failed')
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('backup_foreign_keys_invalid')
  const tables=tableNames(canonical)
  if(JSON.stringify(tableNames(db))!==JSON.stringify(tables))throw Error('backup_table_inventory_mismatch')
  for(const table of tables)if(JSON.stringify(columns(db,table))!==JSON.stringify(columns(canonical,table)))throw Error('backup_column_inventory_mismatch: '+table)
  const ledger=db.prepare('SELECT id,name FROM migrations ORDER BY id').all()
  if(JSON.stringify(ledger)!==JSON.stringify(MIGRATIONS.map(({id,name})=>({id,name}))))throw Error('backup_migration_ledger_mismatch')
  const scalar=query=>Number(Object.values(db.prepare(query).get())[0])
  const ownershipMismatches=scalar(`SELECT count(*) FROM managed_agents a JOIN workers w ON w.id=a.worker_id LEFT JOIN sessions s ON s.id=a.session_id LEFT JOIN terminal_connections c ON c.id=a.connection_id WHERE a.owner_subject!=w.owner_subject OR (s.id IS NOT NULL AND a.owner_subject IS NOT s.owner_subject) OR (c.id IS NOT NULL AND a.owner_subject!=c.owner_subject)`)
   +scalar('SELECT count(*) FROM terminal_connections c JOIN sessions s ON s.id=c.session_id WHERE c.owner_subject IS NOT s.owner_subject')
  if(ownershipMismatches)throw Error('backup_owner_relationship_mismatch')
  const countWhere=(table,where)=>scalar(`SELECT count(*) FROM ${quote(table)} WHERE ${where}`)
  const executionState={
   workerLeases:countWhere('workers','instance_id IS NOT NULL OR lease_expires_at IS NOT NULL'),
   terminalLeases:countWhere('terminal_connections','instance_id IS NOT NULL OR lease_expires_at IS NOT NULL'),
   pendingTerminalCommands:countWhere('terminal_commands',"status IN ('queued','claimed','running')"),
   pendingManagedOperations:countWhere('managed_operations',"status='pending'"),
   pendingCompactions:countWhere('managed_compactions',"status IN ('queued','assigned','running')"),
   unfinishedRollouts:countWhere('runtime_rollouts',"phase NOT IN ('succeeded','failed')"),
   credentialRefreshes:countWhere('provider_oauth_credentials',"state='refreshing'"),
   sendingPushDeliveries:countWhere('push_deliveries',"state='sending'"),
  }
  return {schemaMatches:true,integrity:'ok',foreignKeyViolations:0,ownershipMismatches:0,tableCounts:Object.fromEntries(tables.map(table=>[table,scalar(`SELECT count(*) FROM ${quote(table)}`)])),executionState,requiresExecutionReconciliation:Object.values(executionState).some(n=>n>0),cutoverReady:false,remainingGates:['async-repositories-and-api','reviewed-importer-and-lease-reset','original-encryption-and-vapid-keys','attachments-and-filesystem-state','restore-rehearsal']}
 }finally{if(db){if(reading)db.exec('ROLLBACK');db.close()}canonical.close()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Usage: node audit-sqlite-backup.mjs /absolute/private/backup.db')
 try{console.log(JSON.stringify(auditSqliteBackup(process.argv[2]),null,2))}catch(error){
  // SQLite parser errors can include source values; emit only our fixed diagnostic codes.
  console.error(/^backup_|^standalone_(consistent|delete_journal)_backup_required/.test(error.message)?error.message:'backup_audit_failed');process.exitCode=1
 }
}
