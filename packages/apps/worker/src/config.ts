import { constants, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

export interface WorkerConfig { origin: string; id: string; secret: string; stateDir: string; dockerSocket: string }
export function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const st = lstatSync(path)
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) || st.uid !== process.getuid?.()) throw Error('worker_state_not_private')
}
export function readPrivate(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const st = fstatSync(fd)
    if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o077) || st.uid !== process.getuid?.() || st.size > 8192) throw Error('worker_credential_not_private')
    return readFileSync(fd, 'utf8')
  } finally { closeSync(fd) }
}
export function atomicState(directory: string, name: 'link.json' | 'status.json' | 'runtime-policy.json' | 'key-enrollment.json' | `boot-${string}.json`, value: unknown) {
  if (!['link.json','status.json','runtime-policy.json','key-enrollment.json'].includes(name) && !/^boot-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/.test(name)) throw Error('worker_state_name_invalid')
  privateDirectory(directory)
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, join(directory, name))
    const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY)
    try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
  }
  finally { try { unlinkSync(temporary) } catch {} }
}
export function config(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const stateDir = resolve(env.RUE_WORKER_STATE_DIR ?? '/var/lib/rue-worker')
  privateDirectory(stateDir)
  let saved: { origin?: string; id?: string; secret?: string } = {}
  if (!env.RUE_WORKER_API_URL && !env.RUE_WORKER_ID && !env.RUE_WORKER_SECRET_FILE) {
    try { saved = JSON.parse(readPrivate(join(stateDir, 'link.json'))) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('worker_saved_link_invalid') }
  }
  const origin = env.RUE_WORKER_API_URL ?? saved.origin
  const id = env.RUE_WORKER_ID ?? saved.id
  const secret = env.RUE_WORKER_SECRET_FILE ? readPrivate(env.RUE_WORKER_SECRET_FILE).trim() : saved.secret
  if (typeof origin !== 'string' || !id || !secret) throw Error('worker_configuration_missing')
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw Error('worker_https_origin_required')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !/^rue_worker_[A-Za-z0-9_-]{43}$/.test(secret)) throw Error('worker_credential_invalid')
  const dockerSocket = env.RUE_WORKER_DOCKER_SOCKET ?? '/var/run/docker.sock'
  if (!dockerSocket.startsWith('/')) throw Error('worker_docker_socket_invalid')
  return { origin: url.origin, id, secret, stateDir, dockerSocket }
}
