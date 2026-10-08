import {DatabaseSync} from 'node:sqlite'
import {createHash,randomUUID} from 'node:crypto'
import {createReadStream,lstatSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {sql} from 'drizzle-orm'
import {getTableConfig} from 'drizzle-orm/pg-core'
import {postgresSchema} from '../src/postgres/schema.js'
import {createPostgresDatabase,type RuePostgresDatabase} from '../src/postgres/client.js'
import {migratePostgresDatabase} from '../src/postgres/migrate.js'
import {auditSqliteBackup} from './audit-sqlite-backup.mjs'
import {resetImportedExecutionState,resetCutoverExecutionState,ImportResetBlocked} from './import-execution-reset.js'
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"'
const tableSql=(name:string)=>sql.raw('"public".'+quote(name))
const ordinals=new Set(['terminal_commands','managed_operations','managed_compactions'])
const fingerprint=async(path:string)=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
interface Column {name:string;type:string;pk:number}
export class RehearsalCopyError extends Error {
 constructor(readonly details:{table:string;sqlState:string;column?:string}){super('rehearsal_copy_failed');this.name='RehearsalCopyError'}
}
interface RehearsalReport {rolledBack:boolean;committedForRestore:boolean;committedForCutover?:boolean;sourceSha256?:string;executionReset?:Awaited<ReturnType<typeof resetImportedExecutionState>>;cutoverReady:false;tables:number;rows:number;counts:Record<string,number>;sourceBytesUnchanged:true;requiresExecutionReconciliation:boolean;remainingGates:string[]}
/** COPY VALIDATION ONLY. Always rolls back, and only accepts an empty, explicitly
 * named disposable database. No commit mode, credential decryption, execution
 * authority reset, attachment migration, or claim of a completed restore. */
export async function rehearseSqliteBackup(path:string,db:RuePostgresDatabase,expectedDatabase:string){return copySqliteBackup(path,db,expectedDatabase,false)}
/** A distinct operator-only path: commit an execution-held fixture for pg_dump/
 * pg_restore testing. Still refuses production names and nonempty databases. */
export async function createHeldImportFixture(path:string,db:RuePostgresDatabase,expectedDatabase:string){return copySqliteBackup(path,db,expectedDatabase,true)}
/** Explicit operator-only cutover. Never used by API startup. The source must be
 * a fresh quiescent backup; the operator supplies its independently recorded hash.
 * This commits held data, not live execution authority or a claim of recovery. */
export async function importCutoverBackup(path:string,db:RuePostgresDatabase,confirmation:{expectedDatabase:string;sourceSha256:string;acknowledgeStoppedWriters:boolean;acknowledgeExecutionHold:boolean}){
 if(confirmation.acknowledgeStoppedWriters!==true||confirmation.acknowledgeExecutionHold!==true||!/^rue_(?!rehearsal_|restore_)[a-z][a-z0-9_]{0,55}$/.test(confirmation.expectedDatabase)||!/^[a-f0-9]{64}$/.test(confirmation.sourceSha256))throw Error('cutover_confirmation_required')
 return copySqliteBackup(path,db,confirmation.expectedDatabase,true,confirmation.sourceSha256)
}
async function copySqliteBackup(path:string,db:RuePostgresDatabase,expectedDatabase:string,heldFixture:boolean,cutoverHash?:string):Promise<RehearsalReport>{
 if(!cutoverHash&&!/^rue_rehearsal_[a-f0-9]{32}$/.test(expectedDatabase))throw Error('rehearsal_disposable_database_required')
 auditSqliteBackup(path) // Private-file validation before hashing.
 const before=await fingerprint(path),stat=lstatSync(path),audit=auditSqliteBackup(path)
 if(cutoverHash&&before!==cutoverHash)throw Error('cutover_source_hash_mismatch')
 const configs=Object.values(postgresSchema).map(table=>getTableConfig(table)),names=configs.map(c=>c.name).sort()
 if(JSON.stringify(names)!==JSON.stringify(Object.keys(audit.tableCounts).filter(name=>name!=='migrations').sort()))throw Error('rehearsal_source_inventory_mismatch')
 const source=new DatabaseSync(path,{readOnly:true}),rollback=Symbol('rollback-only');let report:RehearsalReport|undefined,reading=false
 try{
  source.exec('PRAGMA query_only=ON; BEGIN');reading=true
  const columns=new Map(names.map(name=>[name,source.prepare(`PRAGMA table_info(${quote(name)})`).all() as unknown as Column[]]))
  // Topological ordering preserves immediate FK enforcement. No constraints are disabled.
  const ordered:string[]=[],pending=new Set(names)
  while(pending.size){
   const ready=[...pending].filter(name=>(source.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all() as {table:string}[]).every(ref=>ordered.includes(ref.table)))
   if(!ready.length)throw Error('rehearsal_foreign_key_cycle_requires_review')
   for(const name of ready){pending.delete(name);ordered.push(name)}
  }
  await db.transaction(async tx=>{
   if(cutoverHash){const [lock]=await tx.execute<{acquired:boolean}>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('rue:core-coordinator',0)) AS acquired`);if(!lock?.acquired)throw Error('cutover_coordinator_in_use')}
   const [identity]=await tx.execute<{name:string}>(sql`SELECT current_database() AS name`)
   if(identity?.name!==expectedDatabase)throw Error('rehearsal_database_identity_mismatch')
   await tx.execute(sql`SET LOCAL lock_timeout='2s'`);await tx.execute(sql`SET LOCAL statement_timeout='30s'`)
   const inventory=await tx.execute<{table_name:string}>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)
   if(JSON.stringify(inventory.map(row=>row.table_name))!==JSON.stringify(names))throw Error('rehearsal_target_inventory_mismatch')
   await tx.execute(sql`LOCK TABLE ${sql.join(names.map(tableSql),sql`, `)} IN ACCESS EXCLUSIVE MODE`)
   for(const name of names){
    const [count]=await tx.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM ${tableSql(name)}`)
    if(count?.n!==0)throw Error('rehearsal_target_not_empty')
    const actual=await tx.execute<{column_name:string}>(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${name} ORDER BY column_name`)
    const expected=configs.find(c=>c.name===name)!.columns.map(c=>c.name).sort()
    if(JSON.stringify(actual.map(c=>c.column_name))!==JSON.stringify(expected))throw Error('rehearsal_target_columns_mismatch')
   }
   const counts:Record<string,number>={}
   for(const name of ordered){
    const fields=columns.get(name)!,primary=fields.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk),jsonFields=new Map(configs.find(c=>c.name===name)!.columns.filter(c=>['json','jsonb'].includes(c.getSQLType())).map(c=>[c.name,c.getSQLType()]))
    if(!primary.length)throw Error('rehearsal_primary_key_required')
    const rowKey=(row:Record<string,unknown>)=>JSON.stringify(primary.map(c=>String(row[c.name])))
    const statement=source.prepare(`SELECT ${ordinals.has(name)?'rowid AS ordinal, ':''}* FROM ${quote(name)}`);statement.setReadBigInts(true)
    const insertFields=[...fields.map(c=>c.name),...(ordinals.has(name)?['ordinal']:[])]
    let batch:Record<string,unknown>[]=[];counts[name]=0
    const flush=async()=>{
     if(!batch.length)return
     const expected=new Map(batch.map(row=>[rowKey(row),row]))
     const values=batch.map(row=>sql`(${sql.join(insertFields.map(field=>{
      const value=row[field]
      if(typeof value==='bigint'&&(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER)))throw Error('rehearsal_unsafe_integer')
      if(typeof value==='number'&&!Number.isFinite(value))throw Error('rehearsal_nonfinite_number')
      // Preserve JSON text for PostgreSQL's parser; never stringify a JS numeric conversion.
      return sql`${typeof value==='bigint'?value.toString():value}`
     }),sql`, `)})`)
     let returned:Record<string,unknown>[]
     try{returned=await tx.execute<Record<string,unknown>>(sql`INSERT INTO ${tableSql(name)} (${sql.join(insertFields.map(field=>sql.identifier(field)),sql`, `)}) VALUES ${sql.join(values,sql`, `)} RETURNING *`)}catch(error){
      const cause=(error as {cause?:{code?:unknown;column_name?:unknown}})?.cause??error as {code?:unknown;column_name?:unknown}
      // Never attach the database error: its query/detail may contain complete rows.
      const sqlState=typeof cause?.code==='string'&&/^[0-9A-Z]{5}$/.test(cause.code)?cause.code:'UNKNOWN'
      const column=fields.find(field=>field.name===cause?.column_name)?.name
      throw new RehearsalCopyError({table:name,sqlState,...(column?{column}:{})})
     }
     if(returned.length!==batch.length)throw Error('rehearsal_row_count_mismatch')
     for(const actual of returned){
      const original=expected.get(rowKey(actual));if(!original)throw Error('rehearsal_primary_key_mismatch');expected.delete(rowKey(actual))
      for(const field of fields){
       const value=original[field.name],copy=actual[field.name]
       if(jsonFields.has(field.name))continue // Checked by PostgreSQL below, without JS numeric loss.
       const equal=typeof value==='bigint'?value.toString()===String(copy):value===copy
       if(!equal)throw Error('rehearsal_value_mismatch')
      }
      if(ordinals.has(name)&&String(original.ordinal)!==String(actual.ordinal))throw Error('rehearsal_ordinal_mismatch')
     }
     if(jsonFields.size){
      const mismatches=batch.map(row=>sql`(${sql.join(primary.map(field=>sql`${sql.identifier(field.name)}=${typeof row[field.name]==='bigint'?String(row[field.name]):row[field.name]}`),sql` AND `)} AND (${sql.join([...jsonFields].map(([field,type])=>type==='json'?sql`${sql.identifier(field)}::text IS DISTINCT FROM ${row[field]}`:sql`${sql.identifier(field)} IS DISTINCT FROM ${row[field]}::jsonb`),sql` OR `)}))`)
      const [check]=await tx.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM ${tableSql(name)} WHERE ${sql.join(mismatches,sql` OR `)}`)
      if(check?.n!==0)throw Error('rehearsal_json_mismatch')
     }
     counts[name]+=batch.length;batch=[]
    }
    for(const row of statement.iterate()){batch.push(row);if(batch.length===128)await flush()}await flush()
    if(counts[name]!==audit.tableCounts[name])throw Error('rehearsal_source_changed')
   }
   const after=lstatSync(path)
   if(after.ino!==stat.ino||after.dev!==stat.dev||await fingerprint(path)!==before)throw Error('rehearsal_source_changed')
   const executionReset=heldFixture?(cutoverHash?await resetCutoverExecutionState(tx,expectedDatabase,true):await resetImportedExecutionState(tx,expectedDatabase)):undefined
   if(heldFixture){
    for(const table of configs)for(const column of table.columns.filter(c=>c.generatedIdentity)){
     const [row]=await tx.execute<{maximum:string}>(sql`SELECT COALESCE(MAX(${sql.identifier(column.name)}),0)::text AS maximum FROM ${tableSql(table.name)}`)
     const maximum=BigInt(row!.maximum),next=maximum<0n?1n:maximum+1n
     if(next>BigInt(Number.MAX_SAFE_INTEGER))throw Error('rehearsal_identity_exhausted')
     const [sequence]=await tx.execute<{name:string}>(sql`SELECT pg_get_serial_sequence(${`public.${table.name}`},${column.name}) AS name`)
     const expected=`${table.name}_${column.name}_seq`
     if(sequence?.name!==`public.${expected}`)throw Error('rehearsal_identity_mismatch')
     // ALTER SEQUENCE RESTART is transactional; setval would survive a rollback.
     await tx.execute(sql`ALTER SEQUENCE ${sql.identifier('public')}.${sql.identifier(expected)} RESTART WITH ${sql.raw(next.toString())}`)
    }
   }
   report={rolledBack:!heldFixture,committedForRestore:heldFixture&&!cutoverHash,...(cutoverHash?{committedForCutover:true,sourceSha256:before}:{}),...(executionReset?{executionReset}:{}),cutoverReady:false,tables:names.length,rows:Object.values(counts).reduce((a,b)=>a+b,0),counts,sourceBytesUnchanged:true,requiresExecutionReconciliation:audit.requiresExecutionReconciliation,remainingGates:[...audit.remainingGates,'committed-import-and-durable-restore-rehearsal']}
   if(!heldFixture)throw rollback
  })
 }catch(error){
  if(error!==rollback){if(error instanceof ImportResetBlocked||(error instanceof Error&&/^(rehearsal|import_reset|cutover)_[a-z_]+$/.test(error.message)))throw error;throw Error('rehearsal_copy_failed')}
 }finally{if(reading)source.exec('ROLLBACK');source.close()}
 if(!report)throw Error('rehearsal_rollback_unconfirmed')
 if(!heldFixture)for(const name of names){const [count]=await db.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM ${tableSql(name)}`);if(count?.n!==0)throw Error('rehearsal_rollback_unconfirmed')}
 return report
}

async function main(){
 const path=process.argv[2],adminUrl=process.env.RUE_PG_REHEARSAL_ADMIN_URL
 if(process.argv.length!==3||!path||!adminUrl)throw Error('rehearsal_private_backup_and_admin_url_required')
 auditSqliteBackup(path) // Reject an unsafe source before provisioning anything.
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_rehearsal_'+randomUUID().replaceAll('-','')
 let database:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl);url.pathname='/'+name;database=createPostgresDatabase({url:url.toString(),maxConnections:1})
  await migratePostgresDatabase(database.db)
  console.log(JSON.stringify(await rehearseSqliteBackup(path,database.db,name),null,2))
 }finally{await database?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(error=>{console.error(JSON.stringify({error:'rehearsal_failed',cutoverPerformed:false,...(error instanceof RehearsalCopyError?{details:error.details}:{})}));process.exitCode=1})
}
