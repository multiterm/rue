import {createPostgresDatabase,postgresSchema} from '@multiterm/rue-db/postgres'
import {createRueDatabase} from '@multiterm/rue-db'
import {openDatabase} from '../storage/index.js'
import {encryptionKey} from '../storage/agent-settings.js'
import {readCredentialKey} from '../storage/credential-key.js'
import {Bus} from '../bus/index.js'
import type {Config} from '../config/index.js'
import type {ServerContext} from './context.js'
import {createPostgresSessionServices} from './postgres-session-services.js'
import {createSqliteSessionServices} from './session-services.js'
/** Explicit backend selection. PostgreSQL failures never open a SQLite fallback.
 * Migrations are an operator step, not something the runtime role may perform. */
export async function openServerContext(config:Config,dbPath?:string):Promise<ServerContext>{
 const backend=process.env.RUE_STORAGE_BACKEND??'sqlite'
 if(!['sqlite','postgres'].includes(backend))throw Error('rue_storage_backend_invalid')
 if(backend==='sqlite'){
  if(process.env.RUE_DATABASE_URL||process.env.DATABASE_URL)throw Error('rue_postgres_backend_selection_required')
  const db=openDatabase(dbPath)
  return {db,orm:createRueDatabase(db),sessions:createSqliteSessionServices(db),credentialKey:()=>encryptionKey(db),config,bus:new Bus(),storage:{engine:'sqlite',get available(){return db.open},async close(){db.close()}}}
 }
 if(dbPath!==undefined)throw Error('rue_sqlite_path_forbidden_with_postgres')
 const key=readCredentialKey();if(!key)throw Error('rue_original_encryption_key_required')
 let available=true,closing=false,resolveFailure!:()=>void
 const failure=new Promise<void>(resolve=>{resolveFailure=resolve})
 const pool=createPostgresDatabase()
 const coordinator=createPostgresDatabase({maxConnections:1,idleTimeout:0,onclose:()=>{if(!closing){available=false;resolveFailure();void pool.close().catch(()=>{})}}})
 let closed:Promise<void>|undefined
 const close=()=>closed??=(async()=>{closing=true;available=false;try{await pool.close()}finally{await coordinator.close()}})()
 try{
  const [claim]=await coordinator.sql`SELECT pg_try_advisory_lock(hashtextextended('rue:core-coordinator',0)) AS acquired`
  if(!claim?.acquired)throw Error('coordinator_in_use')
  // Validate every mapped column before serving requests. No DDL or schema push.
  for(const table of Object.values(postgresSchema))await pool.db.select().from(table).limit(0)
  if(!available)throw Error('coordinator_lost')
  return {sessions:createPostgresSessionServices(pool.db,()=>key),credentialKey:()=>key,config,bus:new Bus(),storage:{engine:'postgres',get available(){return available},failure,close}}
 }catch{await close();throw Error('rue_postgres_startup_failed')}
}
