import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { schema } from './schema.js'
export * from './schema.js'
export function createRueDatabase(sqlite:Database.Database){return drizzle(sqlite,{schema})}
export type RueDatabase=ReturnType<typeof createRueDatabase>
