import postgres from 'postgres'
import {drizzle,type PostgresJsDatabase} from 'drizzle-orm/postgres-js'
import {postgresSchema} from './schema.js'
export type RuePostgresDatabase=PostgresJsDatabase<typeof postgresSchema>
export interface PostgresOptions {url?:string;maxConnections?:number;ssl?:postgres.Options<{}>['ssl'];idleTimeout?:number;onclose?:()=>void}
/** Explicit ownership: the API instance closes its own pool, including on failed startup. */
export function createPostgresDatabase(options:PostgresOptions={}){
 const url=options.url??process.env.RUE_DATABASE_URL??process.env.DATABASE_URL
 if(!url)throw Error('RUE_DATABASE_URL is required for PostgreSQL')
 let parsed:URL;try{parsed=new URL(url)}catch{throw Error('Invalid PostgreSQL connection URL')}
 if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error('Expected a PostgreSQL connection URL')
 const max=options.maxConnections??10
 if(!Number.isInteger(max)||max<1||max>100)throw Error('PostgreSQL pool size must be between 1 and 100')
 const sql=postgres(url,{max,connect_timeout:10,idle_timeout:options.idleTimeout??20,prepare:false,...(options.onclose?{onclose:options.onclose}:{}),...(options.ssl===undefined?{}:{ssl:options.ssl})})
 return {db:drizzle(sql,{schema:postgresSchema}),sql,close:()=>sql.end({timeout:5})}
}
