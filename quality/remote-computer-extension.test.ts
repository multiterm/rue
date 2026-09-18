import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ bridges: [] as any[], save: vi.fn(), load: vi.fn(), release: vi.fn(), acquire: vi.fn(), network: vi.fn() }))
vi.mock('../extensions/rue/bridge.mjs', () => ({
  httpsOrigin: (s: string) => s,
  privateStore: () => ({ save: mocks.save, load: mocks.load, acquire: mocks.acquire, remove: vi.fn() }),
  beginPairing: async () => ({ requestId: 'a'.repeat(32), verifier: 'v'.repeat(43) }),
  client: () => mocks.network,
  Bridge: class {
    running: string | undefined; abort = new AbortController(); stopped = false; message = vi.fn(); settled = vi.fn()
    constructor(public state: any, _store: any, public adapter: any) { mocks.bridges.push(this) }
    async start() {}
    stop() { if (this.stopped) return; this.stopped = true; if (this.running) this.adapter.cancel() }
  },
}))
import extension from '../extensions/rue/index'
beforeEach(() => { vi.clearAllMocks(); mocks.bridges.length = 0; mocks.load.mockReturnValue(undefined); mocks.acquire.mockReturnValue(mocks.release); mocks.network.mockResolvedValue({ id: 'term_' + 'a'.repeat(32), token: 'rue_terminal_' + 't'.repeat(43), ownerSubject: 'alice', piSessionId: 'session-a' }) })
function fixture() {
  const events: Record<string, any> = {}, commands: Record<string, any> = {}
  const pi = { on: (name: string, fn: any) => { events[name] = fn }, registerCommand: (name: string, command: any) => { commands[name] = command }, sendUserMessage: vi.fn() }
  let session = 'session-a'
  const ctx = { hasUI: true, sessionManager: { getSessionId: () => session }, isIdle: () => true, hasPendingMessages: () => false, abort: vi.fn(), ui: { input: vi.fn().mockResolvedValueOnce('https://api.test').mockResolvedValueOnce('https://web.test').mockResolvedValueOnce('123456789012'), confirm: vi.fn(async () => true), notify: vi.fn() } }
  extension(pi as any)
  return { pi, ctx, events, commands, session: (id: string) => { session = id } }
}
test('extension is inert until explicit pairing; approved remote text never dispatches slash commands', async () => {
  const { pi, ctx, events, commands } = fixture()
  expect(mocks.network).not.toHaveBeenCalled(); expect(mocks.acquire).not.toHaveBeenCalled()
  await commands.rue.handler('', ctx)
  const b = mocks.bridges[0]; expect(b).toBeDefined()
  b.running = 'command-one'; b.adapter.send('/reload')
  expect(pi.sendUserMessage).toHaveBeenCalledWith('/reload', { expandPromptTemplates: false })
  expect(events.input({ source: 'extension', text: '/reload' }, ctx)).toEqual({ action: 'continue' })
  expect(events.input({ source: 'interactive', text: 'Local competing work' }, ctx)).toEqual({ action: 'handled' })
  events.session_shutdown()
  expect(ctx.abort).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledOnce()
  expect(() => b.adapter.send('stale remote callback')).toThrow('Session changed')
  expect(pi.sendUserMessage).toHaveBeenCalledTimes(1)
})
test('trust is explicit, session-only, reversible, and does not persist', async () => {
  const { ctx, commands, events } = fixture()
  await commands.rue.handler('', ctx)
  const b = mocks.bridges[0], signal = b.abort.signal
  ctx.ui.confirm.mockClear()
  await b.adapter.confirm('first', signal)
  expect(ctx.ui.confirm).toHaveBeenCalledOnce()
  await commands.rue.handler('trust', ctx)
  ctx.ui.confirm.mockClear()
  expect(await b.adapter.confirm('second', signal)).toBe(true)
  expect(await b.adapter.confirm('third', signal)).toBe(true)
  expect(ctx.ui.confirm).not.toHaveBeenCalled()
  expect(JSON.stringify(mocks.save.mock.calls)).not.toContain('trusted')
  await commands.rue.handler('untrust', ctx)
  await b.adapter.confirm('fourth', signal)
  expect(ctx.ui.confirm).toHaveBeenCalledOnce()
  await commands.rue.handler('trust', ctx)
  events.session_shutdown()
  expect(await b.adapter.confirm('stale', signal)).toBe(false)
  mocks.load.mockReturnValue(b.state); ctx.ui.input.mockResolvedValue('https://api.test')
  await commands.rue.handler('resume', ctx)
  ctx.ui.confirm.mockClear()
  await mocks.bridges.at(-1).adapter.confirm('after resume', new AbortController().signal)
  expect(ctx.ui.confirm).toHaveBeenCalledOnce()
})
test('denied trust and approval completing after shutdown never grant trust', async () => {
  const { ctx, commands, events } = fixture()
  await commands.rue.handler('', ctx)
  ctx.ui.confirm.mockResolvedValueOnce(false)
  await commands.rue.handler('trust', ctx)
  ctx.ui.confirm.mockClear()
  await mocks.bridges[0].adapter.confirm('still asks', new AbortController().signal)
  expect(ctx.ui.confirm).toHaveBeenCalledOnce()
  let resolve!: (approved: boolean) => void
  ctx.ui.confirm.mockImplementationOnce(() => new Promise<boolean>(r => { resolve = r }))
  const pending = commands.rue.handler('trust', ctx)
  events.session_shutdown(); resolve(true); await pending
  expect(await mocks.bridges[0].adapter.confirm('stale', new AbortController().signal)).toBe(false)
})
test('explicitly replacing an expired saved link revokes or tolerates expiry before pairing', async () => {
  const { ctx, commands } = fixture()
  mocks.load.mockReturnValue({ id: 'old-link', token: 'expired-token', origin: 'https://api.test', piSessionId: 'session-a' })
  mocks.network.mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 401 }))
  await commands.rue.handler('', ctx)
  expect(ctx.ui.confirm.mock.calls[0]?.[0]).toBe('Replace the saved Rue link?')
  expect(mocks.network.mock.calls[0]).toEqual(['/connections/old-link', undefined, expect.any(AbortSignal), 'DELETE'])
  expect(mocks.bridges).toHaveLength(1)
})
test('shutdown without a remote run does not abort local work; no UI means no pairing', async () => {
  const first = fixture()
  await first.commands.rue.handler('', { ...first.ctx, hasUI: false })
  expect(mocks.network).not.toHaveBeenCalled()
  await first.commands.rue.handler('', first.ctx)
  first.events.session_shutdown()
  expect(first.ctx.abort).not.toHaveBeenCalled()
})
