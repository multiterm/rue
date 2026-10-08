import {agentStatus,branchReader} from './status.ts'
import { providerWithBroker, sharedProviders, type SharedProvider } from './provider-keys.ts'
import { developmentOrigins } from './development.ts'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Bridge, beginPairing, client, httpsOrigin, privateStore, type PromptContent } from './bridge.ts'

// Load with: pi -e /absolute/path/to/rue/extensions/rue/index.ts
// No factory/session-start network calls. A person must explicitly run /rue.
export default function rueExtension(pi: ExtensionAPI) {
  // Reject a stale/mismatched runtime before pairing, not once per message.
  if (Bridge.apiVersion !== 8 || typeof Bridge.prototype.beginMessage !== 'function' || typeof Bridge.prototype.tool !== 'function') throw Error('Rue bridge version mismatch. Restart Pi, then use /rue resume; do not re-pair.')
  const branch=branchReader()
  let bridge: Bridge | undefined
  let release: (() => void) | undefined
  let pairing = false
  // Active trust is derived from local, origin/session-bound preferences only.
  let trusted = false
  let generation = 0
  let injectedText: string | undefined
  let lifetime = new AbortController()
  let clearProviderKeys = () => {}
  const stop = () => {
    trusted = false
    bridge?.stop(); bridge = undefined
    clearProviderKeys(); clearProviderKeys = () => {}
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
  pi.on('tool_execution_start', event => { bridge?.tool(event, 'start') })
  pi.on('tool_execution_update', event => { bridge?.tool(event, 'update') })
  pi.on('tool_execution_end', event => { bridge?.tool(event, 'end') })
  pi.on('message_start', event => { bridge?.beginMessage(event.message) })
  pi.on('message_update', event => { bridge?.message(event.message, true) })
  pi.on('message_end', event => { bridge?.message(event.message) })
  pi.on('agent_start', () => { bridge?.activityChanged() })
  pi.on('agent_settled', () => { bridge?.settled() })
  for (const command of ['rue', 'rue-dev'] as const) pi.registerCommand(command, {
    description: command === 'rue-dev' ? 'Pair/resume using Rue deployment URLs automatically; same consent and sharing controls as /rue.' : 'Pair/resume Rue; status, trust/untrust, share-tools/hide-tools, share-thinking/hide-thinking, share-status/hide-status, or disconnect. Thinking and status sharing are opt-in.',
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return
      if (command === 'rue-dev' && bridge && !bridge.stopped) {
        try {
          if (bridge.state.origin !== developmentOrigins().api) {
            ctx.ui.notify('The active Rue link belongs to another deployment. Use /rue status or /rue disconnect to manage that link.', 'warning'); return
          }
        } catch { ctx.ui.notify('Cannot verify the development deployment. Use /rue status or /rue disconnect to manage the active link.', 'warning'); return }
      }
      if (!['', 'resume', 'disconnect', 'status', 'trust', 'untrust', 'share-tools', 'hide-tools', 'share-thinking', 'hide-thinking', 'share-status', 'hide-status'].includes(args.trim())) { ctx.ui.notify('Use /rue, /rue resume, /rue status, /rue trust, /rue untrust, /rue share-tools, /rue hide-tools, /rue share-thinking, /rue hide-thinking, /rue share-status, /rue hide-status, or /rue disconnect. Never put codes in command arguments.', 'warning'); return }
      if (args.trim() === 'status') { if (bridge) ctx.ui.notify(`Rue transport: ${JSON.stringify(bridge.diagnostics())}`, 'info'); ctx.ui.notify(bridge && !bridge.stopped ? `Rue linked; ${trusted ? 'trusted for this link' : 'approval required per prompt'}; tool output ${bridge.state.shareToolOutput ? 'shared' : 'private'}; exposed thinking ${bridge.state.shareThinking ? 'shared' : 'private'}; provider credential stores remain local.` : 'Rue is disconnected.', 'info'); return }
      if (['share-status','hide-status'].includes(args.trim())) {
        if(!bridge||bridge.stopped){ctx.ui.notify('Link or resume Rue first.','warning');return}
        const active=bridge,epoch=generation,enabled=args.trim()==='share-status'
        if(enabled&&!await ctx.ui.confirm('Share Pi status?', 'Share this session’s directory, Git branch, model, thinking level, context usage and token/cost counters with your Rue account and its manager? No message text or credentials are included.'))return
        if(bridge!==active||active.stopped||generation!==epoch)return
        const previous=bridge.state.shareStatus;bridge.state.shareStatus=enabled
        try{bridge.store.save(bridge.state)}catch{bridge.state.shareStatus=previous;ctx.ui.notify('Status sharing was not changed.','error');return}
        bridge.activityChanged();ctx.ui.notify(enabled?'Pi status sharing enabled for supported Rue servers.':'Future Pi status sharing disabled. Previously delivered metadata cannot be recalled.','info');return
      }
      if (['share-tools', 'hide-tools'].includes(args.trim())) {
        if (!bridge || bridge.stopped) { ctx.ui.notify('Link or resume Rue first.', 'warning'); return }
        const enabled = args.trim() === 'share-tools', previous = bridge.state.shareToolOutput
        bridge.state.shareToolOutput = enabled
        try { bridge.store.save(bridge.state) }
        catch { bridge.state.shareToolOutput = previous; ctx.ui.notify('Could not save the sharing policy; it was not changed.', 'error'); return }
        ctx.ui.notify(enabled ? 'Future tool calls, arguments, text results, and edit diffs will sync to your linked Rue account, including file contents or secrets printed by tools. Images and prior history remain excluded. Exposed thinking has its own separate sharing policy. Use /rue hide-tools to stop future tool sharing.' : 'Future tool output stays local. Already uploaded or queued output is not deleted.', 'info')
        return
      }
      if (['share-thinking', 'hide-thinking'].includes(args.trim())) {
        if (!bridge || bridge.stopped) { ctx.ui.notify('Link or resume Rue first.', 'warning'); return }
        const enabled = args.trim() === 'share-thinking', previous = bridge.state.shareThinking
        bridge.state.shareThinking = enabled
        try { bridge.store.save(bridge.state) }
        catch { bridge.state.shareThinking = previous; ctx.ui.notify('Could not save thinking sharing; it was not changed.', 'error'); return }
        if (!enabled) bridge.finishThinking()
        ctx.ui.notify(enabled ? 'Future exposed thinking blocks will sync to your linked Rue account. They may contain sensitive context. Signatures, redacted blocks and hidden model internals are never uploaded. Use /rue hide-thinking to stop future sharing.' : 'Future thinking stays local. Already uploaded or queued thinking is not deleted.', 'info')
        return
      }
      if (['trust', 'untrust'].includes(args.trim())) {
        if (!bridge || bridge.stopped || pairing) { ctx.ui.notify('Link or resume Rue first.', 'warning'); return }
        const enabled = args.trim() === 'trust', previous = bridge.state.trustRemotePrompts
        bridge.state.trustRemotePrompts = enabled
        try { bridge.store.save(bridge.state) }
        catch { bridge.state.trustRemotePrompts = previous; ctx.ui.notify('Could not save the trust policy; it was not changed.', 'error'); return }
        trusted = enabled
        ctx.ui.notify(enabled ? 'Future Rue prompts are trusted for this saved link. Pi tool permissions still apply. Use /rue untrust to require per-prompt approval.' : 'Per-prompt approval restored and saved for this link. An already approved/running turn is not cancelled; use /rue disconnect to stop it.', 'info')
        return
      }
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
        let deployment: ReturnType<typeof developmentOrigins> | undefined
        if (command === 'rue-dev') {
          try { deployment = developmentOrigins() }
          catch { ctx.ui.notify('Development deployment URLs are unavailable. Sync the Rue deployment metadata or use /rue for a custom deployment.', 'error'); return }
          ctx.ui.notify(`Rue development API:\n${deployment.api}\nDashboard:\n${deployment.webapp}`, 'info')
        }
        const originInput = deployment?.api ?? await ctx.ui.input('Rue API HTTPS origin', 'https://api.rue.multiterm.dev', { signal })
        if (!originInput || !valid(ctx, sessionId, epoch)) return
        const origin = httpsOrigin(originInput), store = privateStore(origin, sessionId)
        release = store.acquire()
        const saved = store.load()
        let state = args.trim() === 'resume' ? saved : undefined
        if (!state) {
          if (args.trim() === 'resume') throw Error('No saved connection')
          if (saved) {
            if (!await ctx.ui.confirm('Replace the saved Rue link?', 'Use /rue resume to keep a valid link. Replacing revokes the old credential and requires pairing again. The same account keeps its existing bot and history. The new link defaults to trusted prompts and shared tool text.', { signal }) || !valid(ctx, sessionId, epoch)) return
            try { await client(origin, saved.token)(`/connections/${encodeURIComponent(saved.id)}`, undefined, signal, 'DELETE') }
            catch (error) { if ((error as { status?: number }).status !== 401) throw error }
            if (!valid(ctx, sessionId, epoch)) return
            store.remove()
          }
          const webInput = deployment?.webapp ?? await ctx.ui.input('Rue dashboard HTTPS origin', 'https://app.rue.multiterm.dev', { signal })
          if (!webInput || !valid(ctx, sessionId, epoch)) return
          const webOrigin = httpsOrigin(webInput)
          if (!await ctx.ui.confirm('Link this computer?', `New user/assistant text and tool calls (including arguments, text output, and edit diffs) will sync to:\n${webOrigin}\n\nTool arguments and output can include private file contents or secrets passed to or printed by commands. This link defaults to trusting remote prompts without per-message approval, using your current model and Pi tool permissions. Use /rue untrust or /rue hide-tools to opt out. Images, prior history and provider credential stores are not uploaded. Exposed thinking stays local unless you explicitly enable /rue share-thinking.`, { signal })) return
          if (!valid(ctx, sessionId, epoch)) return
          const pending = await beginPairing(origin, sessionId)
          if (!valid(ctx, sessionId, epoch)) return
          ctx.ui.notify(`Open this URL and approve the agent:\n${webOrigin}/link-computer?request=${encodeURIComponent(pending.requestId)}`, 'info')
          const code = await ctx.ui.input('Paste the one-time code from Rue (not a chat message)', '', { signal })
          if (!code || !/^\d{12}$/.test(code) || !valid(ctx, sessionId, epoch)) return
          const grant = await client(origin)( '/exchange', { requestId: pending.requestId, verifier: pending.verifier, code }, signal)
          if (!valid(ctx, sessionId, epoch)) return
          if (grant.piSessionId !== sessionId || typeof grant.ownerSubject !== 'string' || !/^term_[A-Za-z0-9_-]{32}$/.test(grant.id) || !/^rue_terminal_[A-Za-z0-9_-]{43}$/.test(grant.token)) throw Error('Invalid grant')
          if (!await ctx.ui.confirm('Confirm Rue account', `Account subject:\n${grant.ownerSubject}\nThis connection can sync this Pi session only. Confirm that it is your intended account.`, { signal })) {
            await client(origin, grant.token)(`/connections/${encodeURIComponent(grant.id)}`, undefined, signal, 'DELETE'); return
          }
          if (!valid(ctx, sessionId, epoch)) return
          await client(origin, grant.token)('/activate', { confirmOwnerSubject: grant.ownerSubject }, signal)
          state = { ...grant, origin, webOrigin, outbox: [], trustRemotePrompts: true, shareToolOutput: true, shareThinking: false }
          store.save(state)
        }
        if (!valid(ctx, sessionId, epoch)) return
        // Missing preferences on older saved links adopt the new defaults;
        // explicit opt-outs survive reload/resume. Never accept these from Rue.
        state.trustRemotePrompts = state.trustRemotePrompts === undefined ? true : state.trustRemotePrompts === true
        state.shareToolOutput = state.shareToolOutput === undefined ? true : state.shareToolOutput === true
        state.shareThinking = state.shareThinking === true // opt-in; legacy/malformed values stay private
        store.save(state)
        trusted = state.trustRemotePrompts
        const adapter = {
          idle: () => valid(ctx, sessionId, epoch) && ctx.isIdle() && !ctx.hasPendingMessages(),
          status:()=>valid(ctx,sessionId,epoch)?agentStatus({cwd:ctx.cwd,branch:branch(ctx.cwd),git:branch.git(ctx.cwd),idle:ctx.isIdle(),model:ctx.model,thinking:pi.getThinkingLevel(),context:ctx.getContextUsage(),entries:ctx.sessionManager.getEntries(),subscription:ctx.model?(ctx.model.provider==='kimi-coding'||ctx.modelRegistry.isUsingOAuth(ctx.model)&&ctx.modelRegistry.getProvider(ctx.model.provider)?.auth.oauth?.isSubscription===true):false}):undefined,
          confirm: async (text: string, abort: AbortSignal) => {
            if (!valid(ctx, sessionId, epoch) || abort.aborted || !bridge || bridge.stopped) return false
            if (trusted) return true
            return ctx.ui.confirm('Approve remote Rue prompt? (Use /rue trust to trust this saved link)', text.replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 100000), { signal: abort })
          },
          send: (text: string, content?: PromptContent[]) => { if (!valid(ctx, sessionId, epoch)) throw Error('Session changed'); injectedText = text; pi.sendUserMessage(content ?? text, { expandPromptTemplates: false }) },
          cancel: () => { if (valid(ctx, sessionId, epoch)) ctx.abort() },
          notify: (message: string) => { if (valid(ctx, sessionId, epoch)) ctx.ui.notify(message, 'info') },
        }
        // Use pristine built-ins: wrapping an already composed provider would
        // accidentally freeze old models.json credentials after their removal.
        let builtins: ReturnType<typeof providerWithBroker>[] = []
        const registry = ctx.modelRegistry
        if (typeof registry?.getRegisteredNativeProvider === 'function' && typeof pi.registerProvider === 'function') {
          const sdkModule = '@earendil-works/pi-coding-agent', aiModule = '@earendil-works/pi-ai'
          const { ModelRuntime } = await import(/* @vite-ignore */ sdkModule) as typeof import('@earendil-works/pi-coding-agent')
          const { InMemoryCredentialStore } = await import(/* @vite-ignore */ aiModule) as typeof import('@earendil-works/pi-ai')
          // No auth.json reads/writes or catalog network refresh. Preserve Pi's
          // cached/built-in catalog machinery without capturing models.json.
          const pristine = await ModelRuntime.create({ modelsPath: null, credentials: new InMemoryCredentialStore(), allowModelNetwork: false, signal })
          builtins = pristine.getProviders().filter(provider => sharedProviders.includes(provider.id as SharedProvider)
            && !registry.getRegisteredProviderIds().includes(provider.id))
        }
        if (!valid(ctx, sessionId, epoch)) return
        const installed = new Map<string, ReturnType<typeof providerWithBroker>>()
        clearProviderKeys = () => {
          for (const [id, provider] of installed) {
            // Never remove a newer registration belonging to another extension.
            if (registry.getRegisteredNativeProvider(id) === provider) pi.unregisterProvider(id)
          }
          installed.clear()
        }
        bridge = new Bridge(state, store, adapter)
        const active = bridge
        await bridge.start(() => {
          for (const base of builtins) {
            const provider = providerWithBroker(base, async (mode, requestSignal) => {
              if (active !== bridge || !valid(ctx, sessionId, epoch) || active.stopped) return
              const result = await active.providerCredential(base.id as SharedProvider, mode, requestSignal)
              return active === bridge && valid(ctx, sessionId, epoch) && !active.stopped ? result : undefined
            },event=>{if(active===bridge&&valid(ctx,sessionId,epoch))active.recordUsage(event)})
            installed.set(base.id, provider)
            pi.registerProvider(provider)
          }
        })
        if (valid(ctx, sessionId, epoch) && !bridge.stopped) ctx.ui.notify(`Rue linked. Remote prompts: ${trusted ? 'trusted' : 'approval required'}. Tool text: ${state.shareToolOutput ? 'shared (may include file contents or printed secrets)' : 'private'}. Use /rue untrust or /rue hide-tools to opt out; /rue trust or /rue share-tools to re-enable. Exposed thinking: ${state.shareThinking ? 'shared' : 'private; /rue share-thinking to enable'}. Enable remote prompts in Rue Settings → Remote agents. Pi tool permissions still apply.`, 'info')
      } catch { if (valid(ctx, sessionId, epoch)) { ctx.ui.notify('Rue linking failed. Check the HTTPS origins, request/code, account, and private state directory. Local provider credential stores were not uploaded.', 'error'); bridge?.stop(); bridge = undefined; clearProviderKeys(); clearProviderKeys = () => {} } }
      finally { if (valid(ctx, sessionId, epoch)) { pairing = false; if (!bridge || bridge.stopped) { release?.(); release = undefined } } }
    },
  })
}
