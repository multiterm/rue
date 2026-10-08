import type {ProjectAuthority} from './project-authority.js'
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
  sessions?: import('./session-services.js').SessionServices
  /** Present only in the temporary SQLite compatibility backend. */
  db?: Database
  storage?: {engine:'sqlite'|'postgres';readonly available:boolean;close():Promise<void>;failure?:Promise<void>}
  credentialKey?:()=>Buffer|undefined
  stopping?:boolean
  pushTransport?:import('./web-push.js').PushTransport
  /** Drizzle ORM facade over the same SQLite connection used by legacy stores. */
  orm?: RueDatabase
  config: Config
  bus: Bus
  activeRuns?: Map<string, number>
  historyResets?: Set<string>
  terminalSocketEnabled?: boolean
  projectAuthority?:ProjectAuthority
}

declare module 'hono' {
  interface ContextVariableMap {
    ctx: ServerContext
    principal: AuthPrincipal
  }
}
