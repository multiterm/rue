import {sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
/** Acquire before binding/worker/provider row locks. Only call inside a transaction.
 * This shared namespace serializes owner mutations and quota checks across stores. */
export async function lockPostgresOwner(tx:Pick<RuePostgresDatabase,'execute'>,owner:string){
 if(!owner||owner.length>512)throw Error('owner_lock_invalid')
 await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rue:owner:${owner}`},0))`)
}
