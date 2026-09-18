import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Bridge, beginPairing, client, httpsOrigin, privateStore } from './bridge.mjs'

// Load with: pi -e /absolute/path/to/rue/extensions/rue/index.ts
// No factory/session-start network calls. A person must explicitly run /rue.
export default function rueExtension(pi: ExtensionAPI) {
  let bridge: Bridge | undefined
  let release: (() => void) | undefined
  let pairing = false
  let generation = 0
  let injectedText: string | undefined
  let lifetime = new AbortController()
  const stop = () => {
    bridge?.stop(); bridge = undefined
    generation++; injectedText = undefined; lifetime.abort(); lifetime = new AbortController()
    release?.(); release = undefined; pairing = false
  }
  const valid = (ctx: ExtensionContext, sessionId: string, epoch: number) => generation === epoch && ctx.sessionManager.getSessionId() === sessionId
  pi.on('session_shutdown', stop)
  pi.on('session_before_tree', () => { stop() })
  pi.on('input', (event, ctx) => {
    if (event.source === 'extension' && injectedText !== undefined && event.text === injectedText) { injectedText = undefined; return { action: 'continue' } }
    if (bridge?.running) { ctx.ui.notify('A Rue remote turn is running. Use /rue disconnect before starting local work.', 'warning'); return { action: 'handled' } }
  })
  pi.on('message_update', event => { bridge?.message(event.message, true) })
  pi.on('message_end', event => { bridge?.message(event.message) })
  pi.on('agent_settled', () => { bridge?.settled() })
  pi.registerCommand('rue', {
    description: 'Pair this Pi session with Rue; /rue resume, status, or disconnect. Keys stay local.',
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return
      if (!['', 'resume', 'disconnect', 'status'].includes(args.trim())) { ctx.ui.notify('Use /rue, /rue resume, /rue status, or /rue disconnect. Never put codes in command arguments.', 'warning'); return }
      if (args.trim() === 'status') { ctx.ui.notify(bridge && !bridge.stopped ? 'Rue linked; provider credentials remain local.' : 'Rue is disconnected.', 'info'); return }
      if (args.trim() === 'disconnect') {
        const state = bridge?.state
        stop()
        if (state) {
          try { await client(state.origin, state.token)(`/connections/${encodeURIComponent(state.id)}`, undefined, undefined, 'DELETE'); privateStore(state.origin, state.piSessionId).remove() }
          catch { ctx.ui.notify('Local bridge stopped. Revoke this computer in Rue settings if the server could not be reached.', 'warning') }
        }
        return
      }
      if (pairing || (bridge && !bridge.stopped)) { ctx.ui.notify('Already linking/linked. Disconnect first.', 'warning'); return }
      if (!ctx.isIdle() || ctx.hasPendingMessages()) { ctx.ui.notify('Wait for Pi to become idle before linking Rue.', 'warning'); return }
      stop(); pairing = true
      const epoch = generation, sessionId = ctx.sessionManager.getSessionId(), signal = lifetime.signal
      try {
        const originInput = await ctx.ui.input('Rue API HTTPS origin', 'https://3668e4ec-138a8a71.sandblocks.dev', { signal })
        if (!originInput || !valid(ctx, sessionId, epoch)) return
        const origin = httpsOrigin(originInput), store = privateStore(origin, sessionId)
        release = store.acquire()
        let state = args.trim() === 'resume' ? store.load() : undefined
        if (!state) {
          if (args.trim() === 'resume') throw Error('No saved connection')
          if (store.load()) { ctx.ui.notify('This session already has a saved link. Use /rue resume, then disconnect/revoke it before pairing again.', 'warning'); return }
          const webInput = await ctx.ui.input('Rue dashboard HTTPS origin', 'https://3668e4ec-b31185d9.sandblocks.dev', { signal })
          if (!webInput || !valid(ctx, sessionId, epoch)) return
          const webOrigin = httpsOrigin(webInput)
          if (!await ctx.ui.confirm('Link this computer?', `New user and assistant TEXT will sync to ${webOrigin}. Prior history, tool results, reasoning, and provider credentials are not uploaded. Remote prompts require local approval and use your current model and tool permissions.`, { signal })) return
          if (!valid(ctx, sessionId, epoch)) return
          const pending = await beginPairing(origin, sessionId)
          if (!valid(ctx, sessionId, epoch)) return
          ctx.ui.notify(`Open ${webOrigin}/link-computer?request=${encodeURIComponent(pending.requestId)} and approve this computer.`, 'info')
          const code = await ctx.ui.input('Paste the one-time code from Rue (not a chat message)', '', { signal })
          if (!code || !/^\d{12}$/.test(code) || !valid(ctx, sessionId, epoch)) return
          const grant = await client(origin)( '/exchange', { requestId: pending.requestId, verifier: pending.verifier, code }, signal)
          if (!valid(ctx, sessionId, epoch)) return
          if (grant.piSessionId !== sessionId || typeof grant.ownerSubject !== 'string' || !/^term_[A-Za-z0-9_-]{32}$/.test(grant.id) || !/^rue_terminal_[A-Za-z0-9_-]{43}$/.test(grant.token)) throw Error('Invalid grant')
          if (!await ctx.ui.confirm('Confirm Rue account', `Account subject: ${grant.ownerSubject}\nThis connection can sync this Pi session only. Confirm that it is your intended account.`, { signal })) {
            await client(origin, grant.token)(`/connections/${encodeURIComponent(grant.id)}`, undefined, signal, 'DELETE'); return
          }
          if (!valid(ctx, sessionId, epoch)) return
          await client(origin, grant.token)('/activate', { confirmOwnerSubject: grant.ownerSubject }, signal)
          state = { ...grant, origin, webOrigin, outbox: [] }
          store.save(state)
        }
        if (!valid(ctx, sessionId, epoch)) return
        const adapter = {
          idle: () => valid(ctx, sessionId, epoch) && ctx.isIdle() && !ctx.hasPendingMessages(),
          confirm: (text: string, abort: AbortSignal) => ctx.ui.confirm('Approve remote Rue prompt?', text.replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 100000), { signal: abort }),
          send: (text: string) => { if (!valid(ctx, sessionId, epoch)) throw Error('Session changed'); injectedText = text; pi.sendUserMessage(text, { expandPromptTemplates: false }) },
          cancel: () => { if (valid(ctx, sessionId, epoch)) ctx.abort() },
          notify: (message: string) => { if (valid(ctx, sessionId, epoch)) ctx.ui.notify(message, 'info') },
        }
        bridge = new Bridge(state, store, adapter)
        await bridge.start()
        if (valid(ctx, sessionId, epoch) && !bridge.stopped) ctx.ui.notify('Rue linked. Enable remote prompts in Settings → Remote computers. Provider keys remain on this computer.', 'info')
      } catch { if (valid(ctx, sessionId, epoch)) { ctx.ui.notify('Rue linking failed. Check the HTTPS origins, request/code, account, and private state directory. No provider credentials were sent.', 'error'); bridge?.stop(); bridge = undefined } }
      finally { if (valid(ctx, sessionId, epoch)) { pairing = false; if (!bridge || bridge.stopped) { release?.(); release = undefined } } }
    },
  })
}
