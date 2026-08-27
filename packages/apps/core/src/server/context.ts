import type { Database } from 'better-sqlite3'
import type { Config } from '../config/index.js'
import type { Bus } from '../bus/index.js'
import type { RueDatabase } from '@multiterm/rue-db'

/**
 * Per-server runtime context. Threaded through Hono via `c.var.ctx`.
 *
 * We deliberately don't use Hono's variable map for individual fields —
 * passing one ctx object keeps testing trivial (pass a fake) and avoids
 * fanning the types out across every handler.
 */
export interface AuthPrincipal {
  subject: string
  principalType: 'user' | 'machine' | 'local'
  scopes: string[]
}

export interface ServerContext {
  db: Database
  /** Drizzle ORM facade over the same SQLite connection used by legacy stores. */
  orm?: RueDatabase
  config: Config
  bus: Bus
  activeRuns?: Map<string, number>
}

declare module 'hono' {
  interface ContextVariableMap {
    ctx: ServerContext
    principal: AuthPrincipal
  }
}
