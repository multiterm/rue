import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {getTableConfig} from 'drizzle-orm/pg-core'
import {MIGRATIONS} from '../../../apps/core/src/storage/schema.js'
import {postgresSchema} from '../src/postgres/schema.js'

test('PostgreSQL schema covers every canonical SQLite table and column',()=>{
 const sqlite=new DatabaseSync(':memory:')
 try{
  for(const migration of MIGRATIONS)sqlite.exec(migration.sql)
  const tables=sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='migrations' ORDER BY name").all() as {name:string;sql:string}[]
  const postgres=new Map(Object.values(postgresSchema).map(table=>{const config=getTableConfig(table);return [config.name,config] as const}))
  assert.deepEqual([...postgres.keys()].sort(),tables.map(table=>table.name))
  for(const table of tables){
   const config=postgres.get(table.name)!
   const columns=sqlite.prepare(`PRAGMA table_info(${JSON.stringify(table.name)})`).all() as {name:string;type:string;pk:number}[]
   for(const source of columns){
    const target=config.columns.find(column=>column.name===source.name)
    assert.ok(target,`Missing PostgreSQL column ${table.name}.${source.name}`)
    if(source.type==='REAL')assert.equal(target.getSQLType(),'double precision',`${table.name}.${source.name}`)
    if(source.pk&&/\bAUTOINCREMENT\b/i.test(table.sql))assert.ok(target.generatedIdentity,`${table.name}.${source.name} needs generated identity`)
   }
  }
 }finally{sqlite.close()}
})

test('domain schema generator check detects stale output without rewriting files',()=>{
 const script=fileURLToPath(new URL('../scripts/generate-domain-schema.mjs',import.meta.url))
 const result=spawnSync(process.execPath,[script,'--check'],{encoding:'utf8'})
 assert.equal(result.status,0,result.stderr||result.stdout)
 assert.match(result.stdout,/up to date/)
})
