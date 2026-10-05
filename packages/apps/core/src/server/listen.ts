import {configuredPushTransport,startPushDispatcher} from './web-push.js'
import { serve, type ServerType } from '@hono/node-server'
import { Bus } from '../bus/index.js'
import type { Config } from '../config/index.js'
import { openDatabase } from '../storage/index.js'
import type { Database } from 'better-sqlite3'
import { createApp } from './app.js'
import { SocketRouter } from './socket-router.js'
import { installWorkerSocket } from './worker-socket.js'
import { installTerminalSocket } from './terminal-socket.js'
import type { Server } from 'node:http'
import {configuredTenancyVerifier} from './tenancy-verifier.js'
import {ProjectAuthority,fenceProjectAuthorityOnBoot} from './project-authority.js'
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
  await fenceProjectAuthorityOnBoot(ctx.db)
  if(!ctx.projectAuthority){const verifier=configuredTenancyVerifier();if(verifier)ctx.projectAuthority=new ProjectAuthority(ctx.db,verifier)}

  if(!ctx.pushTransport)ctx.pushTransport=configuredPushTransport(ctx.db)
  const terminalPairing = process.env.RUE_TERMINAL_BRIDGE === 'true' || ['development', 'develop'].includes(process.env.SANDBLOCKS_RUNTIME ?? '')
  const managedWorkers = process.env.RUE_MANAGED_WORKERS === 'true' && ctx.config.keyname.enabled
  const app = createApp({ ctx, log: opts.log, terminalPairing, managedWorkers, managedAgents: process.env.RUE_MANAGED_AGENTS === 'true' })

  const { hostname, port } = opts.config.server
  const server: ServerType = await new Promise((resolve) => {
    const s = serve(
      { fetch: app.fetch, hostname, port },
      (info) => resolve(s as unknown as ServerType),
    )
  })
  ctx.terminalSocketEnabled = terminalPairing && ctx.config.keyname.enabled
  const socketRouter = new SocketRouter(server as Server)
  const disposeSocket = ctx.terminalSocketEnabled ? installTerminalSocket(server as Server, ctx, request => app.fetch(request), socketRouter) : undefined
  const disposeWorkerSocket = managedWorkers ? installWorkerSocket(socketRouter, ctx) : undefined
  const stopPush=ctx.pushTransport?startPushDispatcher(ctx.db,ctx.pushTransport):undefined
  const address = server.address()
  const resolvedPort =
    typeof address === 'object' && address !== null ? address.port : port
  const url = `http://${hostname}:${resolvedPort}`

  return {
    url,
    hostname,
    port: resolvedPort,
    ctx,
    close: async () => {
      await stopPush?.()
      return new Promise<void>((resolveClose, reject) => {
        disposeWorkerSocket?.(); disposeSocket?.(); socketRouter.close()
        server.close((err: Error | undefined) => (err ? reject(err) : resolveClose()))
      })
    },
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
