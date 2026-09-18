import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants, mkdirSync, lstatSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function httpsOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Use an HTTPS origin without a path or credentials')
  return url.origin
}
export function textOnly(message) {
  if (!['user', 'assistant'].includes(message.role)) return ''
  const text = typeof message.content === 'string' ? message.content : (message.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n')
  return text.length > 100000 ? text.slice(0, 99970) + '\n[Text truncated by Rue]' : text
}
export function privateStore(origin, sessionId, root = join(homedir(), '.local', 'state', 'rue', 'pi-links')) {
  origin = httpsOrigin(origin)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const stat = lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw Error('Rue state directory must be private and owned by you')
  const path = join(root, createHash('sha256').update(JSON.stringify([origin, sessionId])).digest('hex') + '.json')
  return {
    acquire() {
      const fd = openSync(path + '.lock', 'wx', 0o600)
      writeFileSync(fd, String(process.pid)); closeSync(fd)
      let released = false
      return () => { if (!released) { released = true; try { unlinkSync(path + '.lock') } catch {} } }
    },
    load() {
      let fd
      try {
        const s = lstatSync(path)
        if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) || s.uid !== process.getuid?.()) throw Error('Unsafe Rue state file')
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
        const data = JSON.parse(readFileSync(fd, 'utf8'))
        if (data.origin !== origin || data.piSessionId !== sessionId) throw Error('Rue session binding mismatch')
        return data
      } catch (e) { if (e.code === 'ENOENT') return undefined; throw e }
      finally { if (fd !== undefined) closeSync(fd) }
    },
    save(data) {
      if (data.origin !== origin || data.piSessionId !== sessionId) throw Error('Rue session binding mismatch')
      const serialized = JSON.stringify(data)
      if (Buffer.byteLength(serialized) > 1_000_000) throw Error('Rue outbox is full; reconnect before continuing')
      const temp = path + '.' + randomUUID()
      try { writeFileSync(temp, serialized, { mode: 0o600, flag: 'wx' }); renameSync(temp, path) }
      finally { try { unlinkSync(temp) } catch {} }
    },
    remove() { try { unlinkSync(path) } catch (e) { if (e.code !== 'ENOENT') throw e } },
  }
}
export function client(origin, token, fetcher = globalThis.fetch) {
  origin = httpsOrigin(origin)
  return async (path, body, signal, method) => {
    const response = await fetcher(origin + '/terminal-client' + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) })
    if (!response.ok) { const error = Error('Rue connection request failed'); error.status = response.status; throw error }
    return response.json()
  }
}
export async function beginPairing(origin, piSessionId, fetcher) {
  const verifier = randomBytes(32).toString('base64url')
  const result = await client(origin, undefined, fetcher)('/requests', { piSessionId, challenge: createHash('sha256').update(verifier).digest('hex') })
  return { ...result, verifier }
}

// The adapter owns local UI and Pi execution. This transport never reads provider
// credentials, session files, tools, system prompts, reasoning, or environment values.
export class Bridge {
  constructor(state, store, adapter, fetcher) {
    this.state = state; this.store = store; this.adapter = adapter
    this.request = client(state.origin, state.token, fetcher)
    this.instance = randomUUID(); this.abort = new AbortController()
    this.stopped = false; this.approving = false; this.running = undefined; this.version = 0
    this.text = ''; this.finishedText = ''; this.failed = false; this.tickBusy = false
    this.lastSuccess = Date.now(); this.dirty = false
    this.state.outbox ??= []
  }
  async start() {
    // Never redispatch a possibly-executed command after process/session replacement.
    if (this.state.outbox.some(e => e.kind === 'output')) this.adapter.notify('Previous remote output may be interrupted; no prompt will be replayed.')
    this.state.outbox = this.state.outbox.filter(e => e.kind === 'mirror')
    this.store.save(this.state)
    await this.call('attach', { instance: this.instance })
    if (this.stopped) return
    this.timer = setInterval(() => void this.tick(), 1500)
    await this.tick()
  }
  call(path, data) { return this.request(`/connections/${encodeURIComponent(this.state.id)}/relay/${path}`, data, this.abort.signal) }
  queue(entry) {
    if (this.stopped) return
    if (this.state.outbox.length >= 100) { this.stop('Rue outbox full; local messages stopped syncing.'); return }
    this.state.outbox.push(entry)
    try { this.store.save(this.state) } catch { this.stop('Cannot persist Rue outbox; sync stopped.'); throw Error('Cannot persist Rue outbox') }
  }
  async tick() {
    if (this.stopped || this.tickBusy) return
    this.tickBusy = true
    try {
      const snapshot = await this.call('poll', { instance: this.instance })
      if (this.stopped) return
      this.lastSuccess = Date.now()
      if (this.running && (!snapshot.remoteEnabled || !snapshot.commands.some(c => c.id === this.running && c.status === 'running'))) {
        this.stop('Remote run disabled or interrupted.'); return
      }
      if (this.running && this.dirty) {
        this.dirty = false
        this.queue({ kind: 'output', command: this.running, version: ++this.version, text: this.text, status: 'running' })
      }
      while (this.state.outbox.length && !this.stopped) {
        const item = this.state.outbox[0]
        if (item.kind === 'mirror') await this.call('mirror', { instance: this.instance, eventId: item.eventId, role: item.role, text: item.text })
        else await this.call(`commands/${item.command}/output`, { instance: this.instance, version: item.version, text: item.text, status: item.status })
        if (this.stopped) return
        this.state.outbox.shift(); this.store.save(this.state)
      }
      if (!this.running && !this.approving && snapshot.remoteEnabled && this.adapter.idle()) {
        const next = snapshot.commands.find(c => c.status === 'queued')
        if (next) { this.approving = true; void this.dispatch(next).catch(() => this.stop('Remote prompt interrupted; it will not replay.')) }
      }
    } catch (e) {
      if ([401,403,409].includes(e.status) || Date.now() - this.lastSuccess > 25000) this.stop('Rue disconnected or credential revoked. Reconnect explicitly.')
    } finally { this.tickBusy = false }
  }
  async dispatch(command) {
    try {
      await this.call(`commands/${command.id}/claim`, { instance: this.instance })
      if (this.stopped) return
      const approved = await this.adapter.confirm(command.text, this.abort.signal)
      if (this.stopped) return
      if (!approved || !this.adapter.idle()) { await this.call(`commands/${command.id}/reject`, { instance: this.instance }); return }
      await this.call(`commands/${command.id}/start`, { instance: this.instance })
      if (this.stopped) return
      if (!this.adapter.idle()) { this.stop('Local work started; remote command interrupted.'); return }
      this.running = command.id; this.version = 0; this.text = ''; this.finishedText = ''; this.failed = false
      // Marked running durably on the server before dispatch. An ambiguous crash
      // requires a fresh user prompt, never an automatic command replay.
      this.adapter.send(command.text)
    } finally { this.approving = false }
  }
  message(message, partial = false) {
    if (this.stopped) return
    const text = textOnly(message)
    if (this.running) {
      if (message.role !== 'assistant') return // Suppress the dashboard user-message echo.
      this.text = (this.finishedText + text).slice(0, 100000); this.dirty = true
      if (!partial) { this.finishedText = this.text + '\n'; this.failed ||= ['error','aborted'].includes(message.stopReason) }
    } else if (!partial && text) this.queue({ kind: 'mirror', eventId: randomUUID(), role: message.role, text })
  }
  settled() {
    if (!this.running || this.stopped) return
    this.queue({ kind: 'output', command: this.running, version: ++this.version, text: this.text, status: this.failed ? 'failed' : 'completed' })
    this.running = undefined; this.dirty = false
  }
  stop(reason = 'Rue disconnected.') {
    if (this.stopped) return
    this.stopped = true; clearInterval(this.timer); this.abort.abort()
    if (this.running) this.adapter.cancel()
    this.adapter.notify(reason)
  }
}
