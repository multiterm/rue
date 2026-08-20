import type { Database } from 'better-sqlite3'
import type { Config } from '../config/index.js'
import type { Bus } from '../bus/index.js'

/**
 * Per-server runtime context. Threaded through Hono via `c.var.ctx`.
 *
 * We deliberately don't use Hono's variable map for individual fields —
 * passing one ctx object keeps testing trivial (pass a fake) and avoids
 * fanning the types out across every handler.
 */
export interface ServerContext {
  db: Database
  config: Config
  bus: Bus
}

declare module 'hono' {
  interface ContextVariableMap {
    ctx: ServerContext
  }
}
