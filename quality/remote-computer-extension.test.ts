import { beforeEach, expect, test, vi } from 'vitest'
import { ModelRuntime, ModelRegistry } from '@earendil-works/pi-coding-agent'
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai'
const mocks = vi.hoisted(() => ({ bridges: [] as any[], beginMessage: vi.fn(), tool: vi.fn(), save: vi.fn(), load: vi.fn(), release: vi.fn(), acquire: vi.fn(), network: vi.fn(), deployment: vi.fn() }))
vi.mock('../extensions/rue/development.ts', () => ({ developmentOrigins: mocks.deployment }))
vi.mock('../extensions/rue/bridge.ts', () => ({
  httpsOrigin: (s: string) => s,
  privateStore: () => ({ save: mocks.save, load: mocks.load, acquire: mocks.acquire, remove: vi.fn() }),
  beginPairing: async () => ({ requestId: 'a'.repeat(32), verifier: 'v'.repeat(43) }),
  client: () => mocks.network,
  Bridge: class {
    static apiVersion = 8
    beginMessage(...args: any[]) { mocks.beginMessage(...args) }
    tool(...args: any[]) { mocks.tool(...args) }
    running: string | undefined; abort = new AbortController(); stopped = false; message = vi.fn(); settled = vi.fn(); finishThinking = vi.fn()
    constructor(public state: any, public store: any, public adapter: any) { mocks.bridges.push(this) }
    async start(onAttached?: () => void) { onAttached?.() }
    async providerCredential(_provider: string, mode: string) { return mode === 'key' ? { granted: true, apiKey: 'fixture-shared-key' } : { granted: true } }
    activityChanged() {}
    diagnostics() { return { state: this.stopped ? 'stopped' : 'connected' } }
    stop() { if (this.stopped) return; this.stopped = true; if (this.running) this.adapter.cancel() }
  },
}))
import extension from '../extensions/rue/index'
beforeEach(() => { vi.clearAllMocks(); mocks.deployment.mockReset().mockReturnValue({ api: 'https://api.test', webapp: 'https://web.test' }); mocks.bridges.length = 0; mocks.load.mockReturnValue(undefined); mocks.acquire.mockReturnValue(mocks.release); mocks.network.mockResolvedValue({ id: 'term_' + 'a'.repeat(32), token: 'rue_terminal_' + 't'.repeat(43), ownerSubject: 'alice', piSessionId: 'session-a' }) })
function fixture() {
  const events: Record<string, any> = {}, commands: Record<string, any> = {}
  const pi = { on: (name: string, fn: any) => { events[name] = fn }, registerCommand: (name: string, command: any) => { commands[name] = command }, sendUserMessage: vi.fn() }
  let session = 'session-a'
  const ctx = { hasUI: true, sessionManager: { getSessionId: () => session }, isIdle: () => true, hasPendingMessages: () => false, abort: vi.fn(), ui: { input: vi.fn().mockResolvedValueOnce('https://api.test').mockResolvedValueOnce('https://web.test').mockResolvedValueOnce('123456789012'), confirm: vi.fn(async () => true), notify: vi.fn() } }
  extension(pi as any)
  return { pi, ctx, events, commands, session: (id: string) => { session = id } }
}
test('pairing wires shared keys into the real Pi SDK and disconnect preserves newer provider registrations', async () => {
  vi.stubEnv('OPENAI_API_KEY', '')
  const create = ModelRuntime.create.bind(ModelRuntime)
  const createSpy = vi.spyOn(ModelRuntime, 'create').mockImplementation(options => create({ ...options, modelsStore: new InMemoryModelsStore() }))
  try {
    const runtime = await create({ modelsPath: null, credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), allowModelNetwork: false })
    const { pi, ctx, commands } = fixture()
    Object.assign(pi, { registerProvider: (provider: any) => runtime.registerNativeProvider(provider), unregisterProvider: (id: string) => runtime.unregisterProvider(id) })
    Object.assign(ctx, { modelRegistry: new ModelRegistry(runtime) })
    await commands.rue.handler('', ctx)
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ modelsPath: null, allowModelNetwork: false }))
    expect((await runtime.getAuth('openai'))?.auth.apiKey).toBe('fixture-shared-key')
    const newer = { ...runtime.getRegisteredNativeProvider('google')!, name: 'Another extension' }
    runtime.registerNativeProvider(newer)
    await commands.rue.handler('disconnect', ctx)
    expect(runtime.getRegisteredNativeProvider('openai')).toBeUndefined()
    expect(runtime.getRegisteredNativeProvider('google')).toBe(newer)
    expect(await runtime.getAuth('openai')).toBeUndefined()
  } finally { createSpy.mockRestore(); vi.unstubAllEnvs() }
})
test('development pairing asks only for the code and keeps explicit account consent', async () => {
  const { ctx, commands } = fixture()
  ctx.ui.input.mockReset().mockResolvedValue('123456789012')
  await commands['rue-dev'].handler('', ctx)
  expect(ctx.ui.input).toHaveBeenCalledTimes(1)
  expect(ctx.ui.input.mock.calls[0]?.[0]).toContain('one-time code')
  expect(ctx.ui.confirm).toHaveBeenCalledTimes(2)
  expect(mocks.bridges[0].state).toMatchObject({ origin: 'https://api.test', webOrigin: 'https://web.test' })
  expect(ctx.ui.notify.mock.calls.some(([text]) => text === `Open this URL and approve the agent:\nhttps://web.test/link-computer?request=${'a'.repeat(32)}`)).toBe(true)
})
test('development resume uses only the deployment origin and preserves local opt-outs', async () => {
  const { ctx, commands } = fixture()
  mocks.load.mockReturnValue({ origin: 'https://api.test', piSessionId: 'session-a', trustRemotePrompts: false, shareToolOutput: false, shareThinking: false })
  await commands['rue-dev'].handler('resume', ctx)
  expect(ctx.ui.input).not.toHaveBeenCalled()
  expect(mocks.bridges[0].state.trustRemotePrompts).toBe(false)
})
test('development controls cannot revoke or change another deployment link', async () => {
  const { ctx, commands } = fixture()
  await commands.rue.handler('', ctx)
  const active = mocks.bridges[0]
  mocks.deployment.mockReturnValue({ api: 'https://other.test', webapp: 'https://other-web.test' })
  mocks.network.mockClear()
  await commands['rue-dev'].handler('untrust', ctx)
  await commands['rue-dev'].handler('disconnect', ctx)
  expect(active.state.trustRemotePrompts).toBe(true); expect(active.stopped).toBe(false)
  expect(mocks.network).not.toHaveBeenCalled()
})
test('missing development metadata never falls back to another deployment', async () => {
  const { ctx, commands } = fixture()
  mocks.deployment.mockImplementation(() => { throw Error('missing') })
  await commands['rue-dev'].handler('', ctx)
  expect(ctx.ui.input).not.toHaveBeenCalled(); expect(mocks.acquire).not.toHaveBeenCalled(); expect(mocks.network).not.toHaveBeenCalled()
  expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('deployment URLs are unavailable'), 'error')
})
test('extension is inert until explicit pairing; approved remote text never dispatches slash commands', async () => {
  const { pi, ctx, events, commands } = fixture()
  expect(mocks.network).not.toHaveBeenCalled(); expect(mocks.acquire).not.toHaveBeenCalled()
  await commands.rue.handler('', ctx)
  const b = mocks.bridges[0]; expect(b).toBeDefined()
  const message = { role: 'assistant', content: [{ type: 'text', text: 'Visible reply' }] }
  events.message_start({ message }); events.message_update({ message }); events.message_end({ message })
  expect(mocks.beginMessage).toHaveBeenCalledWith(message)
  const event = { toolCallId: 'read-one', toolName: 'read', args: { path: 'README.md' } }
  events.tool_execution_start(event); events.tool_execution_update(event); events.tool_execution_end(event)
  expect(mocks.tool.mock.calls).toEqual([[event, 'start'], [event, 'update'], [event, 'end']])
  expect(b.message.mock.calls).toEqual([[message, true], [message]])
  b.running = 'command-one'; b.adapter.send('/reload')
  expect(pi.sendUserMessage).toHaveBeenCalledWith('/reload', { expandPromptTemplates: false })
  expect(events.input({ source: 'extension', text: '/reload' }, ctx)).toEqual({ action: 'continue' })
  expect(events.input({ source: 'interactive', text: 'Local competing work' }, ctx)).toEqual({ action: 'handled' })
  events.session_shutdown()
  expect(ctx.abort).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledOnce()
  expect(() => b.adapter.send('stale remote callback')).toThrow('Session changed')
  expect(pi.sendUserMessage).toHaveBeenCalledTimes(1)
})
test('new links default to trust and tool sharing; opt-outs persist across resume', async () => {
  const { ctx, commands, events } = fixture()
  await commands.rue.handler('', ctx)
  const b = mocks.bridges[0], signal = b.abort.signal
  expect(b.state).toMatchObject({ trustRemotePrompts: true, shareToolOutput: true })
  expect(ctx.ui.confirm.mock.calls[0]?.[1]).toContain('defaults to trusting remote prompts')
  ctx.ui.confirm.mockClear()
  expect(await b.adapter.confirm('first', signal)).toBe(true)
  expect(ctx.ui.confirm).not.toHaveBeenCalled()
  await commands.rue.handler('untrust', ctx)
  await commands.rue.handler('hide-tools', ctx)
  expect(b.state).toMatchObject({ trustRemotePrompts: false, shareToolOutput: false })
  await b.adapter.confirm('asks now', signal)
  expect(ctx.ui.confirm).toHaveBeenCalledOnce()
  events.session_shutdown()
  expect(await b.adapter.confirm('stale', signal)).toBe(false)
  mocks.load.mockReturnValue(b.state); ctx.ui.input.mockResolvedValue('https://api.test')
  await commands.rue.handler('resume', ctx)
  ctx.ui.confirm.mockClear()
  const resumed = mocks.bridges.at(-1)
  expect(resumed.state.shareToolOutput).toBe(false)
  await resumed.adapter.confirm('after resume', new AbortController().signal)
  expect(ctx.ui.confirm).toHaveBeenCalledOnce()
  ctx.ui.confirm.mockClear()
  await commands.rue.handler('trust', ctx)
  expect(resumed.state.trustRemotePrompts).toBe(true)
  expect(await resumed.adapter.confirm('trusted again', new AbortController().signal)).toBe(true)
  expect(ctx.ui.confirm).not.toHaveBeenCalled()
})
test('thinking sharing is opt-in, persists independently, and fails closed on save errors', async () => {
  const { ctx, commands, events } = fixture()
  await commands.rue.handler('', ctx)
  const b = mocks.bridges[0]
  expect(b.state.shareThinking).toBe(false)
  mocks.save.mockImplementationOnce(() => { throw Error('disk unavailable') })
  await commands.rue.handler('share-thinking', ctx)
  expect(b.state.shareThinking).toBe(false)
  await commands.rue.handler('share-thinking', ctx)
  expect(b.state.shareThinking).toBe(true)
  expect(b.state.shareToolOutput).toBe(true)
  events.session_shutdown()
  mocks.load.mockReturnValue(b.state); ctx.ui.input.mockResolvedValue('https://api.test')
  await commands.rue.handler('resume', ctx)
  const resumed = mocks.bridges.at(-1)
  expect(resumed.state.shareThinking).toBe(true)
  await commands.rue.handler('hide-thinking', ctx)
  expect(resumed.state.shareThinking).toBe(false)
  expect(resumed.finishThinking).toHaveBeenCalledOnce()
  expect(resumed.state.shareToolOutput).toBe(true)
})

test.each([undefined, false, 'true', null, true])('thinking opt-in normalizes fail-closed on resume: %j', async shareThinking => {
  const { ctx, commands } = fixture()
  mocks.load.mockReturnValue({ id: 'saved', origin: 'https://api.test', piSessionId: 'session-a', shareThinking })
  await commands.rue.handler('resume', ctx)
  expect(mocks.bridges[0].state.shareThinking).toBe(shareThinking === true)
})

test('legacy links adopt missing defaults while keeping an explicit sharing opt-out', async () => {
  const { ctx, commands } = fixture()
  mocks.load.mockReturnValue({ id: 'saved', origin: 'https://api.test', piSessionId: 'session-a', shareToolOutput: false })
  await commands.rue.handler('resume', ctx)
  const b = mocks.bridges[0]
  expect(b.state).toMatchObject({ trustRemotePrompts: true, shareToolOutput: false, shareThinking: false })
  ctx.ui.confirm.mockClear()
  expect(await b.adapter.confirm('trusted legacy link', new AbortController().signal)).toBe(true)
  expect(ctx.ui.confirm).not.toHaveBeenCalled()
})
test.each([
  [{}, true, true],
  [{ trustRemotePrompts: true, shareToolOutput: true }, true, true],
  [{ trustRemotePrompts: false }, false, true],
  [{ trustRemotePrompts: 'true', shareToolOutput: null }, false, false],
])('resume normalizes local preferences without overriding opt-outs: %j', async (preferences, trust, sharing) => {
  const { ctx, commands } = fixture()
  mocks.load.mockReturnValue({ id: 'saved', origin: 'https://api.test', piSessionId: 'session-a', ...preferences })
  await commands.rue.handler('resume', ctx)
  expect(mocks.bridges[0].state).toMatchObject({ trustRemotePrompts: trust, shareToolOutput: sharing })
})

test('trust stays disabled if persistence fails and stale or aborted sessions fail closed', async () => {
  const { ctx, commands, session } = fixture()
  await commands.rue.handler('', ctx)
  const b = mocks.bridges[0]
  await commands.rue.handler('untrust', ctx)
  mocks.save.mockImplementationOnce(() => { throw Error('disk full') })
  await commands.rue.handler('trust', ctx)
  expect(b.state.trustRemotePrompts).toBe(false)
  ctx.ui.confirm.mockClear()
  await b.adapter.confirm('still asks', new AbortController().signal)
  expect(ctx.ui.confirm).toHaveBeenCalledOnce()
  await commands.rue.handler('trust', ctx)
  const cancelled = new AbortController(); cancelled.abort()
  expect(await b.adapter.confirm('cancelled', cancelled.signal)).toBe(false)
  session('another-session')
  expect(await b.adapter.confirm('stale', new AbortController().signal)).toBe(false)
})
test('default trust never bypasses initial pairing confirmation', async () => {
  const { ctx, commands } = fixture()
  ctx.ui.confirm.mockResolvedValueOnce(false)
  await commands.rue.handler('', ctx)
  expect(mocks.bridges).toHaveLength(0)
  expect(mocks.network).not.toHaveBeenCalled()
  expect(mocks.release).toHaveBeenCalledOnce()
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
test('tool sharing defaults on and remains independent of remote-prompt trust', async () => {
  const { ctx, commands } = fixture()
  await commands.rue.handler('', ctx)
  const b = mocks.bridges[0]
  expect(b.state.shareToolOutput).toBe(true)
  await commands.rue.handler('untrust', ctx)
  expect(b.state.shareToolOutput).toBe(true)
  await commands.rue.handler('share-tools', ctx)
  expect(b.state.shareToolOutput).toBe(true)
  expect(mocks.save).toHaveBeenLastCalledWith(b.state)
  await commands.rue.handler('hide-tools', ctx)
  expect(b.state.shareToolOutput).toBe(false)
  mocks.save.mockImplementationOnce(() => { throw Error('disk full') })
  await commands.rue.handler('share-tools', ctx)
  expect(b.state.shareToolOutput).toBe(false)
})

test('shutdown without a remote run does not abort local work; no UI means no pairing', async () => {
  const first = fixture()
  await first.commands.rue.handler('', { ...first.ctx, hasUI: false })
  expect(mocks.network).not.toHaveBeenCalled()
  await first.commands.rue.handler('', first.ctx)
  first.events.session_shutdown()
  expect(first.ctx.abort).not.toHaveBeenCalled()
})
