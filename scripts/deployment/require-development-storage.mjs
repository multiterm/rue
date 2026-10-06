import { readFileSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function hasPersistentMount(mountinfo, path = '/tmp/.local/share/rue') {
  return mountinfo.split('\n').some(line => {
    const [mount, filesystem] = line.split(' - ')
    return mount?.split(' ')[4] === path && Boolean(filesystem) && !['tmpfs', 'ramfs', 'overlay', 'devtmpfs'].includes(filesystem.split(' ')[0])
  })
}
export function requiresSqliteMount(env=process.env) {
  const backend=env.RUE_STORAGE_BACKEND??'sqlite'
  if(backend==='postgres') {
    if(!(env.RUE_DATABASE_URL||env.DATABASE_URL)||!(env.RUE_SETTINGS_ENCRYPTION_KEY||env.RUE_SETTINGS_ENCRYPTION_KEY_FILE))throw Error('PostgreSQL URL and original encryption key are required')
    return false
  }
  if(backend!=='sqlite'||env.RUE_DATABASE_URL||env.DATABASE_URL)throw Error('Invalid or mixed storage backend configuration')
  return true
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if(requiresSqliteMount()) {
    const path = '/tmp/.local/share/rue'
    if (!hasPersistentMount(readFileSync('/proc/self/mountinfo', 'utf8'))) throw new Error('Private persistent development storage is not mounted; refusing a tmpfs fallback')
    const directory = statSync(path)
    if ((directory.mode & 0o077) !== 0 || directory.uid !== process.getuid()) throw new Error('Development data directory must be service-owned and private')
  }
  const args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  if (!args.length) throw new Error('Development API command required')
  // This launcher is development-only. Keep an explicit false override and leave
  // production startup untouched; core still requires Keyname owner authentication.
  const child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: { ...process.env, RUE_MANAGED_WORKERS: process.env.RUE_MANAGED_WORKERS ?? 'true', RUE_MANAGED_AGENTS: process.env.RUE_MANAGED_AGENTS ?? 'true' } })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.once('error', () => { console.error('Could not start development API'); process.exitCode = 1 })
  child.once('exit', code => { process.exitCode = code ?? 1 })
}
