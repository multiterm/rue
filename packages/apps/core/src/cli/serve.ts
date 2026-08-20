import type { CommandModule } from 'yargs'
import { loadConfig } from '../config/index.js'
import { listen } from '../server/index.js'
import { seedFromEnv } from '../auth/index.js'

export interface ServeArgs {
  hostname?: string
  port?: number
  password?: string
  log?: boolean
}

export const serveCommand: CommandModule<unknown, ServeArgs> = {
  command: 'serve',
  describe: 'Run the rue HTTP server',
  builder: (y) =>
    y
      .option('hostname', {
        type: 'string',
        describe: 'Bind hostname (overrides config)',
      })
      .option('port', {
        type: 'number',
        describe: 'Bind port; pass 0 for an OS-assigned port',
      })
      .option('password', {
        type: 'string',
        describe: 'Require HTTP Basic auth with this password',
      })
      .option('log', {
        type: 'boolean',
        describe: 'Verbose HTTP request logging',
        default: false,
      }),
  handler: async (argv) => {
    const cfg = loadConfig()
    if (argv.hostname) cfg.server.hostname = argv.hostname
    if (argv.port !== undefined) cfg.server.port = argv.port
    if (argv.password) cfg.server.password = argv.password
    await seedFromEnv()
    const server = await listen({ config: cfg, log: argv.log })
    // Print the URL so SDKs and supervisors can pick it up.
    process.stdout.write(`rue server listening on ${server.url}\n`)
    const shutdown = async (signal: string) => {
      process.stderr.write(`\nrue: received ${signal}, shutting down\n`)
      await server.close()
      process.exit(0)
    }
    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
  },
}
