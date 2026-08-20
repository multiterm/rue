import { serve, type ServerType } from '@hono/node-server'
import { Bus } from '../bus/index.js'
import type { Config } from '../config/index.js'
import { openDatabase } from '../storage/index.js'
import type { Database } from 'better-sqlite3'
import { createApp } from './app.js'
import type { ServerContext } from './context.js'
import { createRueDatabase } from '@multiterm/rue-db'

export interface ListenOptions {
  config: Config
  /** Override DB path (tests). */
  dbPath?: string
  /** Pre-built context (tests); if provided, no DB is opened. */
  ctx?: ServerContext
  log?: boolean
}

export interface RueServer {
  url: string
  hostname: string
  port: number
  ctx: ServerContext
  close(): Promise<void>
}

/**
 * Start the rue HTTP server.
 *
 * - Opens (or accepts) the DB.
 * - Builds the Hono app.
 * - Binds to host:port from config (or a random free port if port=0).
 *
 * Returns a handle with the resolved URL and a `close()` for clean shutdown.
 */
export async function listen(opts: ListenOptions): Promise<RueServer> {
  const ctx: ServerContext = opts.ctx ?? (() => {
    const db = openDatabase(opts.dbPath)
    return { db, orm: createRueDatabase(db), config: opts.config, bus: new Bus() }
  })()
  if (!ctx.orm) ctx.orm = createRueDatabase(ctx.db)

  const app = createApp({ ctx, log: opts.log })

  const { hostname, port } = opts.config.server
  const server: ServerType = await new Promise((resolve) => {
    const s = serve(
      { fetch: app.fetch, hostname, port },
      (info) => resolve(s as unknown as ServerType),
    )
  })
  const address = server.address()
  const resolvedPort =
    typeof address === 'object' && address !== null ? address.port : port
  const url = `http://${hostname}:${resolvedPort}`

  return {
    url,
    hostname,
    port: resolvedPort,
    ctx,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((err: Error | undefined) => (err ? reject(err) : resolveClose()))
      }),
  }
}

/** Helper: dispose a server context (closes DB; safe to call multiple times). */
export function closeContext(ctx: ServerContext): void {
  try {
    ;(ctx.db as Database).close()
  } catch {
    // already closed
  }
}
