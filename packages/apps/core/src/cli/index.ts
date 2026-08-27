import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { serveCommand } from './serve.js'
import { dbCommand } from './db.js'
import { accountCommand } from './account.js'
import { runCommand } from './run.js'
import { tuiCommand } from './tui.js'

export async function run(argv: string[] = hideBin(process.argv)): Promise<void> {
  await yargs(argv)
    .scriptName('rue')
    .usage('$0 <command>')
    .command(serveCommand)
    .command(runCommand)
    .command(tuiCommand)
    .command(dbCommand)
    .command(accountCommand)
    .demandCommand(1)
    .strict()
    .help()
    .version('0.0.0')
    .parseAsync()
}
