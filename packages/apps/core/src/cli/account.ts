import type { CommandModule } from 'yargs'
import { getAuthBackend } from '../auth/index.js'

const list: CommandModule = {
  command: 'list',
  aliases: ['ls'],
  describe: 'List provider credentials known to rue',
  handler: async () => {
    const backend = getAuthBackend()
    const all = await backend.all()
    const masked = Object.fromEntries(
      Object.entries(all).map(([k, v]) => [k, mask(v)]),
    )
    process.stdout.write(JSON.stringify(masked, null, 2) + '\n')
  },
}

const set: CommandModule<unknown, { provider: string; value: string }> = {
  command: 'set <provider> <value>',
  describe: 'Store a credential in the OS keychain',
  builder: (y) =>
    y
      .positional('provider', { type: 'string', demandOption: true })
      .positional('value', { type: 'string', demandOption: true }),
  handler: async (argv) => {
    const backend = getAuthBackend()
    await backend.set(argv.provider, argv.value)
    process.stdout.write(`stored credential for ${argv.provider}\n`)
  },
}

const remove: CommandModule<unknown, { provider: string }> = {
  command: 'remove <provider>',
  aliases: ['rm'],
  describe: 'Remove a credential',
  builder: (y) => y.positional('provider', { type: 'string', demandOption: true }),
  handler: async (argv) => {
    const backend = getAuthBackend()
    const ok = await backend.remove(argv.provider)
    process.stdout.write(`${ok ? 'removed' : 'no entry for'} ${argv.provider}\n`)
  },
}

export const accountCommand: CommandModule = {
  command: 'account <subcommand>',
  describe: 'Manage stored provider credentials (OS keychain)',
  builder: (y) =>
    y
      .command(list)
      .command(set)
      .command(remove)
      .demandCommand(1)
      .strict(),
  handler: () => {},
}

function mask(secret: string): string {
  if (secret.length <= 8) return '••••'
  return secret.slice(0, 4) + '…' + secret.slice(-4)
}
