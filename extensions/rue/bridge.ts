import type {UsageEvent} from './usage.ts'
import type {AgentStatus} from './status.ts'
import {modelErrorNotice} from './model-error.ts'
import { brokerCredential, type SharedProvider, type CredentialMode } from './provider-keys.ts'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants, mkdtempSync, rmSync, mkdirSync, lstatSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { RelaySocket, type SocketFactory } from './socket.ts'

export interface Message {
  role: string
  content?: string | Array<{ type: string; text?: string; thinking?: string; redacted?: boolean }>
  stopReason?: string
  errorMessage?: string
  toolCallId?: string
  toolName?: string
  isError?: boolean
  details?: unknown
}
interface ToolIdentity { id: string; name: string; status: string; chunk?: number }
type Outcome='failed'|'interrupted'
interface Snapshot { version: number; final: boolean; outcome?:Outcome; tool?: ToolIdentity; reasoning?: { id: string; chunk: number } }
interface MessageBlock { kind: 'text' | 'thinking'; id: string; chunks: Chunk[]; closed?: boolean }
interface Chunk { eventId: string; version: number; text: string; final: boolean; outcome?:Outcome }
interface Mirror { kind: 'mirror'; eventId: string; role: string; text: string; snapshot?: Snapshot }
interface Output { kind: 'output'; command: string; version: number; text: string; status: 'running' | 'completed' | 'failed'; transcript?: boolean }
type OutboxEntry = Mirror | Output
export interface BridgeState {
  origin: string; token: string; id: string; piSessionId: string; ownerSubject?: string; sessionId?: string
  usageOutbox?:UsageEvent[]
  outbox: OutboxEntry[]; shareStatus?:boolean; shareToolOutput?: boolean; shareThinking?: boolean; trustRemotePrompts?: boolean
}
interface Store { save(state: BridgeState): void }
export type PromptContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
interface Adapter {
  idle(): boolean; send(text: string, content?: PromptContent[]): void; cancel(): void; notify(text: string): void
  status?():AgentStatus|undefined
  confirm(text: string, signal: AbortSignal): Promise<boolean>
}
type Fetcher = (url: string, init: RequestInit) => Promise<Response>
interface Command { id: string; text: string; status?: string; hasAttachments?: boolean }
export interface ToolEvent {
  toolCallId: string; toolName: string; args?: unknown; isError?: boolean
  partialResult?: { content?: Message['content']; details?: unknown }
  result?: { content?: Message['content']; details?: unknown }
}
interface ToolState {
  id: string; name: string; args: unknown; output: string; diff?: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  chunks: Chunk[]; final: boolean
}
function fenced(text: string, language = 'text') {
  let length = 3
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1)
  const fence = '`'.repeat(length)
  return `${fence}${language}\n${text}\n${fence}`
}
function toolTranscript(tool: ToolState) {
  let args = '[Arguments not available]'
  if (tool.args !== undefined) {
    try { args = JSON.stringify(tool.args, null, 2) ?? args } catch { args = '[Arguments could not be serialized]' }
  }
  const name = tool.name.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80)
  return `### Tool: ${name} — ${tool.status}\n\n**Arguments**\n\n${fenced(args, 'json')}\n\n**Output**\n\n${fenced(tool.output || (tool.status === 'running' ? '[Waiting for output]' : '[No text output]'))}${tool.diff ? `\n\n**Diff**\n\n${fenced(tool.diff, 'diff')}` : ''}`
}

export function httpsOrigin(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Use an HTTPS origin without a path or credentials')
  return url.origin
}
export function textOnly(message: Message): string {
  if (!['user', 'assistant'].includes(message.role)) return ''
  const text = typeof message.content === 'string' ? message.content : (message.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n')
  return text
}
// Tool output is an explicit sharing capability: it can contain private file
// contents and command output. Never infer consent from remote-prompt trust.
export function sharedMessage(message: Message, shareToolOutput = false): Message | undefined {
  if (message.role !== 'toolResult') return message
  if (!shareToolOutput) return undefined
  const name = String(message.toolName ?? 'tool').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80)
  const text = typeof message.content === 'string' ? message.content : (message.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n')
  let fenceLength = 3
  for (const match of text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1)
  const fence = '`'.repeat(fenceLength)
  return { role: 'assistant', content: `Tool output: ${name}${message.isError ? ' (error)' : ''}\n\n${fence}text\n${text || '[No text output]'}\n${fence}` }
}
export function privateStore(origin: string, sessionId: string, root = join(homedir(), '.local', 'state', 'rue', 'pi-links')) {
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
      } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e }
      finally { if (fd !== undefined) closeSync(fd) }
    },
    save(data: BridgeState) {
      if (data.origin !== origin || data.piSessionId !== sessionId) throw Error('Rue session binding mismatch')
      const serialized = JSON.stringify(data)
      if (Buffer.byteLength(serialized) > 1_000_000) throw Error('Rue outbox is full; reconnect before continuing')
      const temp = path + '.' + randomUUID()
      try { writeFileSync(temp, serialized, { mode: 0o600, flag: 'wx' }); renameSync(temp, path) }
      finally { try { unlinkSync(temp) } catch {} }
    },
    remove() { try { unlinkSync(path) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e } },
  }
}
export function client(origin: string, token?: string, fetcher: Fetcher = globalThis.fetch) {
  origin = httpsOrigin(origin)
  return async (path: string, body?: unknown, signal?: AbortSignal, method?: string) => {
    const response = await fetcher(origin + '/terminal-client' + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) })
    if (!response.ok) {
      const retry = response.headers.get('retry-after')
      const retryAfterMs = retry ? Math.min(15000, Math.max(0, /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now())) : 0
      // Never include an untrusted response body (which may contain secrets) in errors.
      void response.body?.cancel().catch(() => {})
      throw Object.assign(Error('Rue connection request failed'), { status: response.status, retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 0 })
    }
    return response.json()
  }
}
export async function beginPairing(origin: string, piSessionId: string, fetcher?: Fetcher) {
  const verifier = randomBytes(32).toString('base64url')
  const result = await client(origin, undefined, fetcher)('/requests', { piSessionId, challenge: createHash('sha256').update(verifier).digest('hex') })
  return { ...result, verifier }
}

// The adapter owns local UI and Pi execution. This transport never reads provider
// credentials, session files, system prompts, or environment values.
// Tool output and plaintext exposed thinking have separate sharing policies;
// thinking signatures and redacted blocks are never serialized.
export class Bridge {
  static readonly apiVersion = 8
  private socket: RelaySocket | undefined
  private socketFactory: SocketFactory | undefined
  private socketConnecting = false
  private socketAttempts = 0
  private socketRetryTimer: ReturnType<typeof setTimeout> | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private controlTimer: ReturnType<typeof setTimeout> | undefined
  private nextHeartbeatAt = 0
  private controlRequested = false
  private async connectSocket() {
    if (!this.socketFactory || this.socketConnecting || this.socket?.connected || !this.watchdog()) return
    this.socketConnecting = true
    const link = new RelaySocket(this.socketFactory, () => this.activityChanged(), error => {
      if (this.socket !== link || this.stopped) return
      this.socket = undefined; this.nextHeartbeatAt = 0
      if ((error as { status?: number }).status) { this.stop('Rue socket authority rejected. Use /rue resume; no command will replay.'); return }
      this.scheduleSocketRetry()
    })
    this.socket = link
    try {
      await link.connect(this.state.origin, { token: this.state.token, id: this.state.id, instance: this.instance }, this.abort.signal)
      if (!this.watchdog()) { link.close(); return }
      this.socketAttempts = 0; this.activityChanged(); this.scheduleFlush()
    } catch (error) {
      link.close(); if (this.socket === link) this.socket = undefined
      if ((error as { status?: number }).status) this.stop('Rue socket authority rejected. Use /rue resume; no command will replay.')
      else this.scheduleSocketRetry()
    } finally { this.socketConnecting = false }
  }
  private scheduleSocketRetry() {
    if (this.stopped || this.socketRetryTimer || ++this.socketAttempts > 3) return
    // Retry only after loss/failure. A healthy socket is never periodically reopened.
    this.socketRetryTimer = setTimeout(() => { this.socketRetryTimer = undefined; void this.connectSocket() }, Math.min(15000, 1000 * 2 ** this.socketAttempts) * (.5 + Math.random() * .5))
  }
  activityChanged() {
    if (this.stopped) return
    // Reconciliation hints can wake authorized transcript uploads, never reset
    // command state or bypass retry backoff / execution fencing.
    this.scheduleFlush()
    this.nextHeartbeatAt = 0
    if (this.tickBusy) { this.controlRequested = true; return }
    clearTimeout(this.controlTimer)
    this.controlTimer = setTimeout(() => { this.controlTimer = undefined; void this.heartbeat() }, 25)
  }
  private scheduleFlush() {
    if (this.stopped || !this.socket?.connected || !this.state.outbox.length || this.flushTimer || this.uploadBusy) return
    this.flushTimer = setTimeout(() => { this.flushTimer = undefined; void this.flush() }, Math.max(40, this.retryAt.upload - performance.now()))
  }
  private attachmentDirs: string[] = []
  private uploadBusy = false
  private leaseDeadline = Infinity
  private leaseWallDeadline = Infinity
  private leaseWallStart = 0
  private watchdogTimer: ReturnType<typeof setInterval> | undefined
  private pendingCommand: string | undefined
  private failures = { control: 0, upload: 0 }
  private retryAt = { control: 0, upload: 0 }
  private retries = 0
  private lastUploadAt: number | null = null
  private pollLatencyMs = 0
  private leaseExpiresAt: number | null = null
  private stopReason = ''
  private statusSupported = false
  private catalogSupported = false
  private catalogAck:string|undefined
  private usageSupported=false
  private usageBusy=false
  private usageRetryAt=0
  recordUsage(event:UsageEvent){
    if(!this.usageSupported||!this.state.shareStatus||this.stopped)return
    const pending=this.state.usageOutbox??=[]
    if(pending.length>=1000){this.adapter.notify('Usage reporting backlog is full; this report was not saved. Inference was not retried.');return}
    pending.push(event)
    try{this.store.save(this.state)}catch{pending.pop();this.adapter.notify('Usage report could not be saved. Inference was not retried.')}
  }
  private async flushUsage(){
    if(this.usageBusy||!this.usageSupported||!this.state.shareStatus||this.usageRetryAt>Date.now()||!this.watchdog())return
    this.usageBusy=true
    try{
      for(let count=0;count<8&&this.state.usageOutbox?.length&&this.watchdog();count++){
        const event=this.state.usageOutbox[0]!
        await this.call('usage',{instance:this.instance,event})
        if(!this.watchdog())return
        this.state.usageOutbox.shift()
        try{this.store.save(this.state)}catch{this.state.usageOutbox.unshift(event);throw Error('Usage acknowledgement not saved')}
      }
    }catch{this.usageRetryAt=Date.now()+30000}
    finally{this.usageBusy=false}
  }
  private connected = false
  diagnostics() {
    return { statusSharing:this.state.shareStatus===true,statusReportingSupported:this.statusSupported,state: this.stopped ? 'stopped' : !this.connected ? 'connecting' : this.failures.control || this.failures.upload ? 'retrying' : 'connected', lastHeartbeatAt: this.connected ? this.lastSuccess : null, leaseExpiresAt: this.leaseExpiresAt, reason: this.stopReason || null, ...this.health(), transport: this.socket?.connected ? 'websocket' : this.socketConnecting ? 'connecting-websocket' : 'https-polling' }
  }
  private health(includeStatus=true) {
    let status:AgentStatus|undefined
    try{if(includeStatus&&this.state.shareStatus)status=this.adapter.status?.()}catch{/* Optional telemetry must not interrupt control or transcript delivery. */}
    if(status&&!this.catalogSupported){const {piVersion,catalog,catalogHash,...legacy}=status;status=legacy}
    else if(status?.catalogHash&&status.catalogHash===this.catalogAck){const {catalog,...summary}=status;status=summary}
    return { ...(status?{status}:{}), transport: this.socket?.connected ? 'websocket' : 'https', agentWorking: !this.adapter.idle(), uploadFailures: this.failures.upload, retries: this.retries, lastUploadAt: this.lastUploadAt, pendingCount: this.state.outbox.length, pendingBytes: Buffer.byteLength(JSON.stringify(this.state.outbox)), pollLatencyMs: this.pollLatencyMs }
  }
  watchdog() {
    if (!this.stopped && (performance.now() >= this.leaseDeadline || Date.now() >= this.leaseWallDeadline || Date.now() < this.leaseWallStart - 1000)) this.stop('Rue lease expired or clock changed. Use /rue resume; no command will replay.')
    return !this.stopped
  }
  private renew(value: any, started: number, wall: number) {
    if (!this.watchdog()) return false
    const ttl = value?.expiresAt - value?.serverNow
    if (value?.protocol !== 2 || !Number.isFinite(ttl) || ttl > 60000) { this.stop('Rue relay protocol mismatch. Update the API and Pi extension, then resume.'); return false }
    if (ttl <= 1000) { this.stop('Rue lease expired. Use /rue resume; no command will replay.'); return false }
    // Anchor at request START, not response arrival; network delay cannot extend authority.
    this.leaseDeadline = started + ttl - 1000
    this.leaseWallStart = wall; this.leaseWallDeadline = wall + ttl - 1000
    this.statusSupported = value.agentStatusVersion === 1
    this.catalogSupported = value.agentCatalogVersion === 1
    this.catalogAck=typeof value.agentCatalogHash==='string'&&/^[a-f0-9]{64}$/.test(value.agentCatalogHash)?value.agentCatalogHash:undefined
    this.leaseExpiresAt = value.expiresAt
    return this.watchdog()
  }
  private retry(error: unknown, lane: 'control' | 'upload') {
    if (this.stopped) return
    const { status, retryAfterMs = 0 } = error as { status?: number; retryAfterMs?: number }
    if (status && status < 500 && ![408, 429].includes(status)) { this.stop(`Rue authority or protocol rejected (HTTP ${status}). Use /rue resume; no command will replay.`); return }
    this.failures[lane] = Math.min(1000000, this.failures[lane] + 1); this.retries = Math.min(1000000, this.retries + 1)
    const ceiling = Math.min(15000, 1500 * 2 ** Math.min(4, this.failures[lane] - 1))
    this.retryAt[lane] = performance.now() + Math.max(Math.min(15000, retryAfterMs), ceiling * (.5 + Math.random() * .5))
    this.watchdog()
  }
  private tools = new Map<string, ToolState>()
  state: BridgeState
  store: Store
  adapter: Adapter
  request: ReturnType<typeof client>
  instance: string
  abort: AbortController
  stopped: boolean
  approving: boolean
  running: string | undefined
  version: number
  text: string
  finishedText: string
  failed: boolean
  tickBusy: boolean
  lastSuccess: number
  dirty: boolean
  localMessage: { role: string; chunks: Chunk[]; blocks: Map<number, MessageBlock> } | undefined
  overflow: Chunk[]
  inFlight: OutboxEntry | undefined
  timer: ReturnType<typeof setInterval> | undefined
  get maintenanceReady(){return !this.stopped&&this.connected&&!this.running&&!this.approving&&!this.uploadBusy&&!this.state.outbox.length&&this.watchdog()}
  private credentialFetch: Fetcher | undefined
  async providerCredential(provider: string, mode: CredentialMode, signal: AbortSignal) {
    return brokerCredential({ kind: 'terminal', origin: this.state.origin, id: this.state.id,
      token: this.state.token, instance: this.instance, signal: this.abort.signal,
      current: () => this.connected && this.watchdog(),
    }, provider, mode, signal, this.credentialFetch)
  }
  constructor(state: BridgeState, store: Store, adapter: Adapter, fetcher?: Fetcher, socketFactory?: SocketFactory) {
    this.state = state; this.store = store; this.adapter = adapter
    this.request = client(state.origin, state.token, fetcher)
    this.credentialFetch = fetcher
    this.socketFactory = socketFactory ?? (!fetcher && typeof globalThis.WebSocket === 'function' ? url => new WebSocket(url) : undefined)
    this.instance = randomUUID(); this.abort = new AbortController()
    this.stopped = false; this.approving = false; this.running = undefined; this.version = 0
    this.text = ''; this.finishedText = ''; this.failed = false; this.tickBusy = false
    this.lastSuccess = Date.now(); this.dirty = false
    this.localMessage = undefined; this.overflow = []; this.inFlight = undefined
    this.state.outbox ??= []
  }
  async start(onAttached?: () => void) {
    // Never redispatch a possibly-executed command after process/session replacement.
    if (this.state.outbox.some(e => e.kind === 'output')) this.adapter.notify('Previous remote output may be interrupted; no prompt will be replayed.')
    this.state.outbox = this.state.outbox.filter(e => e.kind !== 'output')
    this.store.save(this.state)
    const started = performance.now(), wall = Date.now()
    const attached = await this.call('attach', { instance: this.instance, protocol: 2 })
    if (!this.renew(attached.lease, started, wall)) return
    this.usageSupported=attached.usageVersion===1
    this.connected = true; this.lastSuccess = Date.now()
    onAttached?.()
    this.watchdogTimer = setInterval(() => this.watchdog(), 250)
    this.timer = setInterval(() => void this.tick(true), 1500)
    if (attached.transport === 'websocket-v1') await this.connectSocket()
    await this.tick()
  }
  call(path: string, data: unknown) {
    // Large attachment downloads retain their authenticated, bounded HTTP route.
    if (this.socket?.connected && path !== 'attach' && path !== 'usage' && !path.endsWith('/input')) return this.socket.request(path, data)
    return this.request(`/connections/${encodeURIComponent(this.state.id)}/relay/${path}`, data, this.abort.signal)
  }
  queue(entry: OutboxEntry) {
    if (this.stopped) return
    // Keep only the newest unsent snapshot, but never mutate a request whose
    // acknowledgement is in flight. Retrying an ambiguous request stays idempotent.
    const pending = entry.kind === 'mirror' && entry.snapshot
      ? this.state.outbox.findIndex(item => item !== this.inFlight && item.kind === 'mirror' && item.eventId === entry.eventId)
      : -1
    if (pending >= 0) this.state.outbox[pending] = entry
    else {
      if (this.state.outbox.length >= 100) { this.stop('Rue outbox full; local messages stopped syncing.'); return }
      this.state.outbox.push(entry)
    }
    try { this.store.save(this.state) } catch { this.stop('Cannot persist Rue outbox; sync stopped.'); throw Error('Cannot persist Rue outbox') }
    this.scheduleFlush()
  }
  async tick(periodic = false) {
    void this.flushUsage()
    // An upload can remain pending while a subsequent tick renews authority.
    if (!periodic || performance.now() >= this.nextHeartbeatAt) await this.heartbeat(!periodic || !this.socket?.connected)
    await this.flush()
  }
  async heartbeat(includeQueue = true) {
    if (!this.watchdog() || this.tickBusy || performance.now() < this.retryAt.control) return
    clearTimeout(this.controlTimer); this.controlTimer = undefined
    this.tickBusy = true
    const started = performance.now(), wall = Date.now(), observedRun = this.running, observedPending = this.pendingCommand
    try {
      const snapshot = await this.call(includeQueue ? 'poll' : 'heartbeat', { instance: this.instance, protocol: 2, health: this.health(this.statusSupported) })
      if (!this.renew(snapshot.lease, started, wall)) return
      if (!Array.isArray(snapshot.commands) || typeof snapshot.remoteEnabled !== 'boolean') { this.stop('Invalid Rue control response. Resume after updating the API.'); return }
      const owned = snapshot.commands.find((c: Command) => (observedRun && this.running === observedRun && c.id === observedRun) || (observedPending && this.pendingCommand === observedPending && c.id === observedPending))
      if (owned && Number.isFinite(owned.lease_expires_at)) {
        const remaining = owned.lease_expires_at - snapshot.lease.serverNow - 1000
        this.leaseDeadline = Math.min(this.leaseDeadline, started + remaining)
        this.leaseWallDeadline = Math.min(this.leaseWallDeadline, wall + remaining)
        if (!this.watchdog()) return
      }
      this.lastSuccess = Date.now(); this.pollLatencyMs = Math.min(60000, Math.round(performance.now() - started))
      this.failures.control = 0; this.retryAt.control = 0
      this.nextHeartbeatAt = performance.now() + (this.socket?.connected ? 15000 : 1500)
      if ((observedRun && this.running === observedRun && (!snapshot.remoteEnabled || !snapshot.commands.some((c: Command) => c.id === observedRun && c.status === 'running'))) || (observedPending && this.pendingCommand === observedPending && (!snapshot.remoteEnabled || !snapshot.commands.some((c: Command) => c.id === observedPending && ['claimed','running'].includes(c.status ?? ''))))) {
        this.stop('Remote run disabled or interrupted.'); return
      }
      if (!this.running && !this.approving && !this.uploadBusy && !this.state.outbox.length && snapshot.remoteEnabled && this.adapter.idle()) {
        const next = snapshot.commands.find((c: Command) => c.status === 'queued')
        if (next) { this.approving = true; void this.dispatch(next).catch(() => this.stop('Remote prompt interrupted; it will not replay.')) }
      }
    } catch (e) { this.retry(e, 'control') }
    finally { this.tickBusy = false; if (this.controlRequested) { this.controlRequested = false; this.activityChanged() } }
  }
  async flush() {
    if (!this.watchdog() || this.uploadBusy || performance.now() < this.retryAt.upload) return
    this.uploadBusy = true
    const started = performance.now()
    let acknowledged = false
    try {
      if (this.running && this.dirty) { this.dirty = false; this.output('running') }
      // Bound each batch, not stored content. Uploads stay serialized and ordered.
      for (let count = 0; count < 8 && performance.now() - started < 2000 && this.state.outbox.length && this.watchdog(); count++) {
        const item = this.state.outbox[0]
        this.inFlight = item
        if (item.kind === 'mirror') await this.call('mirror', { instance: this.instance, eventId: item.eventId, role: item.role, text: item.text, ...(item.snapshot ? { snapshot: item.snapshot } : {}) })
        else await this.call(`commands/${item.command}/output`, { instance: this.instance, version: item.version, text: item.text, status: item.status, ...(item.transcript ? { transcript: true } : {}) })
        if (!this.watchdog()) return
        this.state.outbox.shift()
        try { this.store.save(this.state) } catch { this.state.outbox.unshift(item); this.stop('Cannot persist Rue acknowledgement; sync stopped.'); return }
        acknowledged = true
        this.lastUploadAt = Date.now(); this.failures.upload = 0; this.retryAt.upload = 0
        this.inFlight = undefined
      }
    } catch (e) { this.retry(e, 'upload') }
    finally {
      this.uploadBusy = false; this.inFlight = undefined; this.scheduleFlush()
      if (this.socket?.connected && acknowledged && !this.state.outbox.length && !this.running && this.adapter.idle()) this.activityChanged()
    }
  }
  async dispatch(command: Command) {
    try {
      if (!this.watchdog()) return
      await this.call(`commands/${command.id}/claim`, { instance: this.instance })
      if (!this.watchdog()) return
      this.pendingCommand = command.id
      const approved = await this.adapter.confirm(command.text, this.abort.signal)
      if (!this.watchdog()) return
      if (!approved || !this.adapter.idle()) { await this.call(`commands/${command.id}/reject`, { instance: this.instance }); return }
      await this.call(`commands/${command.id}/start`, { instance: this.instance })
      if (!this.watchdog()) return
      if (!this.adapter.idle()) { this.stop('Local work started; remote command interrupted.'); return }
      this.version = 0; this.text = ''; this.finishedText = ''; this.failed = false; this.overflow = []
      // Fetch attachments only after local approval and the durable start marker.
      // They never enter the retry outbox or local link state JSON.
      if (command.hasAttachments) {
        const result = await this.call(`commands/${command.id}/input`, { instance: this.instance })
        if (!this.watchdog()) return
        if (!this.adapter.idle()) { this.stop('Local work started; remote command interrupted.'); return }
        const content = this.prepareAttachments(result.content)
        this.running = command.id
        this.adapter.send(content.filter(p => p.type === 'text').map(p => p.text).join('\n'), content)
      } else { this.running = command.id; this.adapter.send(command.text) }
    } finally { this.approving = false; this.pendingCommand = undefined }
  }
  prepareAttachments(parts: Array<{ type: string; text?: string; name?: string; mimeType?: string; data?: string }>): PromptContent[] {
    if (!Array.isArray(parts) || parts.length > 32) throw Error('Invalid attachment content')
    let bytes = 0, files = 0, textLength = 0
    const directory = mkdtempSync(join(tmpdir(), 'rue-attachments-'))
    this.attachmentDirs.push(directory)
    return parts.map(part => {
      if (part.type === 'text' && typeof part.text === 'string') {
        textLength += part.text.length
        if (textLength > 100_000) throw Error('Attachment text too long')
        return { type: 'text', text: part.text }
      }
      if (part.type !== 'file' || typeof part.data !== 'string' || part.data.length > 14_000_000 || ++files > 8) throw Error('Invalid attachment')
      const data = Buffer.from(part.data, 'base64'); bytes += data.length
      if (data.length > 10 * 1024 * 1024 || bytes > 20 * 1024 * 1024) throw Error('Attachments too large')
      if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(part.mimeType ?? '')) return { type: 'image', data: part.data, mimeType: part.mimeType! }
      const name = String(part.name ?? 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
      const path = join(directory, `${files}-${name}`)
      writeFileSync(path, data, { mode: 0o600, flag: 'wx' })
      return { type: 'text', text: `[User attachment ${JSON.stringify(part.name)} available at ${JSON.stringify(path)} (${data.length} bytes). Use tools if needed; the file has not been read or executed. This temporary file is removed when the Rue link disconnects.]` }
    })
  }
  tool(event: ToolEvent, phase: 'start' | 'update' | 'end') {
    if (this.stopped || !this.state.shareToolOutput) return
    let tool = this.tools.get(event.toolCallId)
    if (tool?.final) return
    if (!tool) {
      tool = { id: randomUUID(), name: event.toolName, args: event.args, output: '', status: 'running', chunks: [], final: false }
      this.tools.set(event.toolCallId, tool)
    }
    if (event.args !== undefined) tool.args = event.args
    const result = phase === 'update' ? event.partialResult : phase === 'end' ? event.result : undefined
    if (result) {
      tool.output = textOnly({ role: 'assistant', content: result.content })
      const details = result.details as { diff?: unknown } | undefined
      if (typeof details?.diff === 'string') tool.diff = details.diff
    }
    if (phase === 'end') tool.status = event.isError ? 'failed' : 'completed'
    // Each call has independent IDs/versions, including parallel calls with
    // identical arguments. Finalize only at the canonical toolResult message.
    this.mirrorSnapshot(toolTranscript(tool), 'assistant', tool.chunks, false, tool)
  }
  private toolResult(message: Message) {
    if (!this.state.shareToolOutput || !message.toolCallId || this.tools.get(message.toolCallId)?.final) return
    this.tool({ toolCallId: message.toolCallId, toolName: message.toolName ?? 'tool', result: { content: message.content, details: message.details }, isError: message.isError }, 'end')
    const tool = this.tools.get(message.toolCallId)
    if (!tool) return
    tool.final = true
    this.mirrorSnapshot(toolTranscript(tool), 'assistant', tool.chunks, true, tool)
  }
  beginMessage(message: Message) {
    if (['user', 'assistant'].includes(message.role)) this.localMessage = { role: message.role, chunks: [], blocks: new Map() }
  }
  mirrorSnapshot(text: string, role: string, chunks: Chunk[], final: boolean, tool?: ToolIdentity, reasoningId?: string, outcome?:Outcome) {
    // Split instead of silently losing the tail at the HTTP per-message limit.
    // Chunk IDs survive partial updates and retries, not content-based deduping.
    const count = Math.max(chunks.length, Math.ceil(text.length / 100000))
    for (let index = 0; index < count && !this.stopped; index++) {
      const value = text.slice(index * 100000, (index + 1) * 100000)
      const previous = chunks[index]
      if (previous?.text === value && previous.final === final && previous.outcome===outcome) continue
      const next = { eventId: previous?.eventId ?? randomUUID(), version: (previous?.version ?? 0) + 1, text: value, final, ...(outcome?{outcome}:{}) }
      chunks[index] = next
      this.queue({ kind: 'mirror', eventId: next.eventId, role, text: value, snapshot: { version: next.version, final, ...(outcome?{outcome}:{}), ...(reasoningId ? { reasoning: { id: reasoningId, chunk: index } } : {}), ...(tool ? { tool: { id: tool.id, name: tool.name, status: tool.status, chunk: index } } : {}) } })
    }
  }
  output(status: Output['status']) {
    if (!this.running) return
    this.queue({ kind: 'output', command: this.running, version: ++this.version, text: this.text.slice(0, 100000), status, transcript: true })
  }
  message(input: Message, partial = false) {
    if (this.stopped) return
    if (input.role === 'toolResult' && input.toolCallId) {
      if (!partial) this.toolResult(input)
      return
    }
    const originalRole = input.role
    let message = sharedMessage(input, this.state.shareToolOutput === true)
    if (this.stopped || !message || !['user', 'assistant'].includes(message.role)) return
    const diagnostic=!partial&&message.role==='assistant'&&['error','aborted','length'].includes(message.stopReason??'')?modelErrorNotice(message.errorMessage):undefined
    if(diagnostic)message={...message,content:Array.isArray(message.content)?[...message.content,{type:'text',text:diagnostic}]:`${message.content??''}${message.content?'\n\n':''}${diagnostic}`}
    // Final tool results arrive in source order. Do not mix them into an active
    // local assistant snapshot; each completed tool output is its own message.
    if (originalRole === 'toolResult' && !this.running) this.beginMessage(message)
    const text = textOnly(message)
    const outcome:Outcome|undefined=!partial&&message.role==='assistant'?(message.stopReason==='error'?'failed':message.stopReason==='aborted'?'interrupted':undefined):undefined
    if (this.running) {
      if (message.role !== 'assistant') return // Suppress the dashboard user-message echo.
      this.text = this.finishedText + text; this.dirty = true
      if (!partial) { this.finishedText = this.text + '\n'; this.failed ||= ['error','aborted'].includes(message.stopReason ?? '') }
    }
    // Keep individual assistant messages in source order around tool calls.
    // The remote command aggregate is bookkeeping, not a transcript bubble.
    {
      if (!this.localMessage || this.localMessage.role !== message.role) this.beginMessage(message)
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        const blocks = this.localMessage!.blocks
        message.content.forEach((part, index) => {
          if (part.type !== 'text' && part.type !== 'thinking') return
          let block = blocks.get(index)
          if (!block) { block = { kind: part.type, id: randomUUID(), chunks: [] }; blocks.set(index, block) }
          if (part.type === 'thinking' && (this.state.shareThinking !== true || part.redacted)) { block.closed = true; return }
          if (block.closed) return
          const value = part.type === 'thinking' ? part.thinking : part.text
          if (typeof value !== 'string') return
          // Explicitly select plaintext only; signatures and opaque/redacted
          // payloads never enter the transcript or private outbox.
          this.mirrorSnapshot(value, 'assistant', block.chunks, !partial, undefined, part.type === 'thinking' ? block.id : undefined, outcome)
        })
      } else this.mirrorSnapshot(text, message.role, this.localMessage!.chunks, !partial,undefined,undefined,outcome)
      if (!partial) this.localMessage = undefined
    }
  }
  finishThinking() {
    for (const block of this.localMessage?.blocks.values() ?? []) {
      if (block.kind !== 'thinking' || block.closed) continue
      this.mirrorSnapshot(block.chunks.map(chunk => chunk.text).join(''), 'assistant', block.chunks, true, undefined, block.id)
      block.closed = true
    }
  }
  settled() {
    if (this.stopped) return
    if (this.socket?.connected) this.activityChanged()
    this.finishThinking()
    for (const tool of this.tools.values()) {
      if (!tool.final) {
        tool.status = 'interrupted'
        this.mirrorSnapshot(toolTranscript(tool), 'assistant', tool.chunks, true, tool)
      }
    }
    this.tools.clear()
    if (!this.running) return
    this.output(this.failed ? 'failed' : 'completed')
    this.running = undefined; this.dirty = false
  }
  stop(reason = 'Rue disconnected.') {
    if (this.stopped) return
    this.stopped = true; this.stopReason = reason; clearInterval(this.timer); clearInterval(this.watchdogTimer); this.abort.abort()
    clearTimeout(this.socketRetryTimer); clearTimeout(this.flushTimer); clearTimeout(this.controlTimer); this.socket?.close()
    const ownedRun = this.running; this.running = undefined
    if (ownedRun) this.adapter.cancel()
    for (const directory of this.attachmentDirs) { try { rmSync(directory, { recursive: true, force: true }) } catch {} }
    this.attachmentDirs = []
    this.adapter.notify(reason)
  }
}
