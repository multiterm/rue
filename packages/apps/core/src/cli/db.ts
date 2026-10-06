import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { CommandModule } from 'yargs'
import { Paths } from '../global/paths.js'
import { openDatabase } from '../storage/index.js'
import { migrateLegacyHistory } from '../migrate/index.js'
import {createPostgresDatabase,migratePostgresDatabase} from '@multiterm/rue-db/postgres'

interface MigrateLegacyArgs {
  from?: string
}

const migrateLegacy: CommandModule<unknown, MigrateLegacyArgs> = {
  command: 'migrate-legacy',
  describe: 'Import sessions and messages from the old @multiterm/rue-desktop SQLite history',
  builder: (y) =>
    y.option('from', {
      type: 'string',
      describe:
        'Path to the legacy rue-history.db. Defaults to the standard Electron userData location for this OS.',
    }),
  handler: (argv) => {
    const oldPath = argv.from ?? defaultLegacyDbPath()
    if (!existsSync(oldPath)) {
      process.stderr.write(`No legacy history db at ${oldPath}\n`)
      process.exit(2)
    }
    const db = openDatabase()
    const result = migrateLegacyHistory({ oldDbPath: oldPath, newDb: db })
    db.close()
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  },
}

const backup: CommandModule<unknown, { to?: string }> = {
  command: 'backup',
  describe: 'Create a consistent SQLite backup before deployment or migration',
  builder: (y) => y.option('to', { type: 'string', describe: 'Backup destination path' }),
  handler: async (argv) => {
    if(process.env.RUE_STORAGE_BACKEND==='postgres')throw Error('Use pg_dump --format=custom with the PostgreSQL backup role; SQLite backup is disabled')
    const destination = argv.to ?? join(Paths.data, 'backups', `rue-${new Date().toISOString().replaceAll(':', '-')}.db`)
    mkdirSync(dirname(destination), { recursive: true })
    const db = openDatabase()
    try {
      await db.backup(destination)
      const integrity = db.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') throw new Error(`database integrity check failed: ${String(integrity)}`)
    } finally {
      db.close()
    }
    process.stdout.write(`${destination}\n`)
  },
}

const info: CommandModule = {
  command: 'info',
  describe: 'Print selected database metadata (SQLite compatibility also applies migrations)',
  handler: async () => {
    if(process.env.RUE_STORAGE_BACKEND==='postgres'){
      const pool=createPostgresDatabase()
      try{const [info]=await pool.sql`SELECT current_database() AS database,current_user AS role`;process.stdout.write(JSON.stringify({backend:'postgres',...info})+'\n')}
      catch{throw Error('rue_postgres_info_failed')}finally{await pool.close()}
      return
    }
    const db = openDatabase()
    const migrations = db
      .prepare('SELECT id, name, applied_at FROM migrations ORDER BY id')
      .all()
    db.close()
    process.stdout.write(
      JSON.stringify(
        { paths: Paths, migrations },
        null,
        2,
      ) + '\n',
    )
  },
}

const migratePostgres:CommandModule={
  command:'migrate-postgres',describe:'Apply checked-in PostgreSQL migrations using an operator migration role while the API is stopped',
  handler:async()=>{
    if(process.env.RUE_STORAGE_BACKEND!=='postgres')throw Error('rue_postgres_backend_selection_required')
    const pool=createPostgresDatabase({maxConnections:1,idleTimeout:0})
    try{
      const [claim]=await pool.sql`SELECT pg_try_advisory_lock(hashtextextended('rue:core-coordinator',0)) AS acquired`
      if(!claim?.acquired)throw Error('coordinator_in_use')
      await migratePostgresDatabase(pool.db);process.stdout.write('PostgreSQL migrations applied\n')
    }catch{throw Error('rue_postgres_migration_failed')}finally{await pool.close()}
  },
}
export const dbCommand: CommandModule = {
  command: 'db <subcommand>',
  describe: 'Database utilities',
  builder: (y) =>
    y
      .command(info)
      .command(backup)
      .command(migrateLegacy)
      .command(migratePostgres)
      .demandCommand(1)
      .strict(),
  handler: () => {},
}

/**
 * Best-effort guess of where the old `@multiterm/rue-desktop` (Electron) app stored
 * its history db.
 *
 * Electron uses `app.getPath('userData')` which resolves to
 *   macOS:   ~/Library/Application Support/<productName>
 *   Windows: %APPDATA%/<productName>
 *   Linux:   $XDG_CONFIG_HOME/<productName> (or ~/.config/<productName>)
 *
 * Rue's electron-builder.yml sets productName=Rue (capital R).
 */
function defaultLegacyDbPath(): string {
  const home = homedir()
  const productName = 'Rue'
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', productName, 'rue-history.db')
    case 'win32':
      return join(
        process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
        productName,
        'rue-history.db',
      )
    default:
      return join(
        process.env.XDG_CONFIG_HOME ?? join(home, '.config'),
        productName,
        'rue-history.db',
      )
  }
}
