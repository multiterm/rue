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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = '/tmp/.local/share/rue'
  if (!hasPersistentMount(readFileSync('/proc/self/mountinfo', 'utf8'))) throw new Error('Private persistent development storage is not mounted; refusing a tmpfs fallback')
  const directory = statSync(path)
  if ((directory.mode & 0o077) !== 0 || directory.uid !== process.getuid()) throw new Error('Development data directory must be service-owned and private')
  const args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  if (!args.length) throw new Error('Development API command required')
  const child = spawn(args[0], args.slice(1), { stdio: 'inherit' })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.once('error', () => { console.error('Could not start development API'); process.exitCode = 1 })
  child.once('exit', code => { process.exitCode = code ?? 1 })
}
