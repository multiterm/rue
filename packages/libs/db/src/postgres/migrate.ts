import {fileURLToPath} from 'node:url'
import {migrate} from 'drizzle-orm/postgres-js/migrator'
import type {RuePostgresDatabase} from './client.js'
/** Explicit deployment step; never run destructive schema push against a live database. */
export async function migratePostgresDatabase(db:RuePostgresDatabase,migrationsFolder=fileURLToPath(new URL('../../migrations/postgres/',import.meta.url))){
 await migrate(db,{migrationsFolder})
}
