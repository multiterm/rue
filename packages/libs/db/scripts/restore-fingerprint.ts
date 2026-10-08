import {createHash} from 'node:crypto'
import {sql} from 'drizzle-orm'
import {getTableConfig} from 'drizzle-orm/pg-core'
import {postgresSchema} from '../src/postgres/schema.js'
import type {RuePostgresDatabase} from '../src/postgres/client.js'
/** Stable, value-free comparison across pg_dump/pg_restore. Hash JSON text, not
 * JSONB: arbitrary conversation Unicode must remain representable. Run while
 * the isolated fixture has no writers. Never print archive contents. */
export async function restoreFingerprint(db:RuePostgresDatabase){
 return db.transaction(async tx=>{
  const tables:Record<string,{rows:number;sha256:string}>={},sequences:Record<string,{lastValue:string;called:boolean}>={}
  for(const table of Object.values(postgresSchema).map(t=>getTableConfig(t)).sort((a,b)=>a.name.localeCompare(b.name))){
   const rows=await tx.execute<{digest:string}>(sql`SELECT encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') AS digest FROM ${sql.identifier('public')}.${sql.identifier(table.name)} t ORDER BY digest`)
   const hash=createHash('sha256');for(const row of rows)hash.update(row.digest+'\n')
   tables[table.name]={rows:rows.length,sha256:hash.digest('hex')}
   for(const column of table.columns.filter(c=>c.generatedIdentity)){
    const name=`${table.name}_${column.name}_seq`
    const [state]=await tx.execute<{lastValue:string;called:boolean}>(sql`SELECT last_value::text AS "lastValue",is_called AS called FROM ${sql.identifier('public')}.${sql.identifier(name)}`)
    sequences[name]=state!
   }
  }
  const migrationLedger=await tx.execute<{id:string;hash:string;createdAt:string}>(sql`SELECT id::text AS id,hash,created_at::text AS "createdAt" FROM drizzle.__drizzle_migrations ORDER BY id`)
  return {tables,sequences,migrationLedger:[...migrationLedger]}
 },{isolationLevel:'repeatable read',accessMode:'read only'})
}
