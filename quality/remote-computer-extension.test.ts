import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ bridges: [] as any[], save: vi.fn(), load: vi.fn(), release: vi.fn(), acquire: vi.fn(), network: vi.fn() }))
vi.mock('../extensions/rue/bridge.mjs', () => ({
  httpsOrigin: (s: string) => s,
  privateStore: () => ({ save: mocks.save, load: mocks.load, acquire: mocks.acquire, remove: vi.fn() }),
  beginPairing: async () => ({ requestId: 'a'.repeat(32), verifier: 'v'.repeat(43) }),
  client: () => mocks.network,
  Bridge: class {
    running: string | undefined; stopped = false; message = vi.fn(); settled = vi.fn()
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
test('shutdown without a remote run does not abort local work; no UI means no pairing', async () => {
  const first = fixture()
  await first.commands.rue.handler('', { ...first.ctx, hasUI: false })
  expect(mocks.network).not.toHaveBeenCalled()
  await first.commands.rue.handler('', first.ctx)
  first.events.session_shutdown()
  expect(first.ctx.abort).not.toHaveBeenCalled()
})
