import { useCallback, useEffect, useRef, useState } from 'react'
import type { Conversation, RueSettings, McpTool, Notebook, Skill } from '../../../preload/index.js'
import { OpenRouterError, type ChatMessage, type ToolDefinition } from '../lib/openrouter.js'
import { AnthropicError } from '../lib/anthropic.js'
import { OllamaError } from '../lib/ollama.js'
import { attachmentUid, buildUserMessage, describeAttachment, type Attachment } from '../lib/attachments.js'
import { applySlash, parseSlash } from '../lib/slash.js'
import { ocrDataUrl } from '../lib/ocr.js'
import { extractPdfText } from '../lib/pdf.js'
import { startDictation, isVoiceSupported, type VoiceSession } from '../lib/voice.js'
import { buildRegistry } from '../lib/tools/index.js'
import { runQuery, createSpawner, type DebugEntry } from '../lib/query/index.js'
import { BUNDLED_SKILLS } from '../lib/skills/index.js'
import type { ToolEvent } from '../lib/toolEvents.js'
import type { MessageRole, Rating } from '../components/Message.js'

/** Appended to the system prompt so the model behaves like a careful agent. */
const AGENT_ADDENDUM = `

You have tools to read, search, edit, and create files and run shell commands, scoped to the folders this chat is bound to. Work like a careful coding agent:
- Always read a file before you edit it.
- Prefer edit_file (a precise, unique string replacement) over write_file for changes to existing files.
- Keep changes minimal and focused on what was asked.
- After making changes you may run commands (tests, typecheck, build) to verify them.
- write_file, edit_file, and bash require the user's confirmation — say what you intend to do before calling them.`

/** Appended when deferred tools are sitting behind ToolSearch. */
const TOOLSEARCH_NOTE = `
- Some tools are not listed up front. If you need a capability you don't see, call ToolSearch to load the matching tool, then call it on the next turn.`

/** Appended so the model knows it can persist durable memories. */
const MEMORY_NOTE = `

Persist durable facts across sessions with MemoryWrite — things about the user, their feedback/preferences, and ongoing project context. Don't save what's already in the code or git history.`

/**
 * Appended when self-healing is enabled — turns the agent into a careful
 * repair agent for Rue's own source, which is added to the folder scope.
 */
function selfHealingAddendum(sourcePath: string, referencesPath: string): string {
  return `

## Self-healing mode
Self-healing is enabled. Rue's own source is in your folder scope at ${sourcePath}${
    referencesPath ? `, and a reference implementation is at ${referencesPath}` : ''
  }. You may locate and repair problems in that source. Work as a careful repair agent:
- Diagnose first — locate or reproduce the problem before changing anything.
- Read a file fully before editing; make the smallest change that fixes the issue.
- After editing, run the project's typecheck and tests with the bash tool to verify the fix; if verification fails, iterate until it passes.
- Checkpoint your work with git commits so changes can be reviewed and rolled back.
- Some files are protected (.git and Rue's own tool/debug code) and cannot be edited — work around them.${
    referencesPath ? '\n- Consult the reference implementation when the correct behaviour is unclear.' : ''
  }`
}

export interface DisplayMessage {
  readonly id?: number
  readonly role: MessageRole
  readonly text: string
  readonly streaming?: boolean
  readonly rating?: Rating
  readonly createdAt?: number
  readonly toolEvents?: ReadonlyArray<ToolEvent>
}

export interface RueState {
  readonly settings: RueSettings | null
  readonly conversations: ReadonlyArray<Conversation>
  readonly notebooks: ReadonlyArray<Notebook>
  readonly activeConversationId: number | null
  readonly activeNotebook: Notebook | null
  readonly activeScopes: ReadonlyArray<string>
  readonly messages: ReadonlyArray<DisplayMessage>
  readonly attachments: ReadonlyArray<Attachment>
  readonly prompt: string
  readonly busy: boolean
  readonly status: string | null
  readonly voiceActive: boolean
  readonly mcpTools: ReadonlyArray<McpTool>
  readonly waitingForFirstToken: boolean
  /** Loop trace from the most recent query — populated only in debug mode. */
  readonly debugLog: ReadonlyArray<DebugEntry>

  setPrompt(v: string): void
  setActiveNotebook(n: Notebook | null): void
  updateSettings(partial: Partial<RueSettings>): Promise<void>
  resetAllSettings(): Promise<void>
  refreshNotebooks(): Promise<void>
  selectConversation(id: number): Promise<void>
  newConversation(): Promise<void>
  deleteConversation(id: number): Promise<void>
  renameConversation(id: number, title: string): Promise<void>
  addScope(): Promise<void>
  removeScope(path: string): Promise<void>

  addAttachment(a: Attachment): void
  removeAttachment(idx: number): void
  captureScreen(): Promise<void>
  captureSelection(): Promise<void>
  captureWeb(url: string): Promise<void>
  attachImageFile(file: File): void
  attachPdfFile(file: File): Promise<void>
  attachFiles(files: FileList | ReadonlyArray<File>): void
  toggleVoice(): void

  send(overrideText?: string): Promise<void>
  stop(): void
  regenerate(): Promise<void>
  rateMessage(messageId: number, rating: Rating): Promise<void>
  clearDebugLog(): void
}

export function useRueState(): RueState {
  const [settings, setSettings] = useState<RueSettings | null>(null)
  const [conversations, setConversations] = useState<ReadonlyArray<Conversation>>([])
  const [notebooks, setNotebooks] = useState<ReadonlyArray<Notebook>>([])
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null)
  const [activeNotebook, setActiveNotebook] = useState<Notebook | null>(null)
  const [messages, setMessages] = useState<ReadonlyArray<DisplayMessage>>([])
  const [history, setHistory] = useState<ReadonlyArray<ChatMessage>>([])
  const [attachments, setAttachments] = useState<ReadonlyArray<Attachment>>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [mcpTools, setMcpTools] = useState<ReadonlyArray<McpTool>>([])
  const [builtinTools, setBuiltinTools] = useState<ReadonlyArray<ToolDefinition>>([])
  const [skills, setSkills] = useState<ReadonlyArray<Skill>>(BUNDLED_SKILLS)
  const voiceSessionRef = useRef<VoiceSession | null>(null)
  const [voiceActive, setVoiceActive] = useState(false)
  const [waitingForFirstToken, setWaitingForFirstToken] = useState(false)
  const [debugLog, setDebugLog] = useState<ReadonlyArray<DebugEntry>>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    void window.rue.getSettings().then(setSettings)
    void refreshConversations()
    void refreshNotebooks()
    void window.rue.mcp.listTools().then(setMcpTools)
    void window.rue.tools.list().then(setBuiltinTools)
    void Promise.all([window.rue.skills.list(), window.rue.mcp.listPrompts()])
      .then(([disk, mcpPrompts]) => setSkills([...BUNDLED_SKILLS, ...disk, ...mcpPrompts]))
      .catch(() => undefined)
    const off = window.rue.onAutoSelection(text => {
      setAttachments(prev => [...prev, { uid: attachmentUid(), kind: 'selection', text }])
    })
    return off
  }, [])

  const refreshConversations = useCallback(async () => {
    setConversations(await window.rue.history.list())
  }, [])

  const refreshNotebooks = useCallback(async () => {
    setNotebooks(await window.rue.notebook.list())
  }, [])

  const updateSettings = useCallback(async (partial: Partial<RueSettings>) => {
    setSettings(await window.rue.setSettings(partial))
  }, [])

  const resetAllSettings = useCallback(async () => {
    const fresh = await window.rue.resetSettings()
    setSettings(fresh)
    // Drop any in-flight UI state so the Welcome flow lands on a clean slate.
    setActiveConversationId(null)
    setActiveNotebook(null)
    setMessages([])
    setHistory([])
    setAttachments([])
    setPrompt('')
    setStatus(null)
  }, [])

  const selectConversation = useCallback(async (id: number) => {
    setActiveConversationId(id)
    const stored = await window.rue.history.messages(id)
    const display: DisplayMessage[] = stored.map(m => ({
      id: m.id,
      role: m.role,
      text: m.content,
      rating: m.rating === 0 ? null : (m.rating as Rating),
      createdAt: m.createdAt
    }))
    setMessages(display)
    setHistory(stored.map(m => ({ role: m.role, content: m.content })))
  }, [])

  const newConversation = useCallback(async () => {
    const conv = await window.rue.history.create('New conversation')
    setActiveConversationId(conv.id)
    setMessages([])
    setHistory([])
    await refreshConversations()
  }, [refreshConversations])

  const deleteConversation = useCallback(
    async (id: number) => {
      await window.rue.history.delete(id)
      if (id === activeConversationId) {
        setActiveConversationId(null)
        setMessages([])
        setHistory([])
      }
      await refreshConversations()
    },
    [activeConversationId, refreshConversations]
  )

  const renameConversation = useCallback(
    async (id: number, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      await window.rue.history.rename(id, trimmed)
      await refreshConversations()
    },
    [refreshConversations]
  )

  const scopesFor = useCallback(
    (convId: number | null): ReadonlyArray<string> =>
      convId === null ? [] : (conversations.find(c => c.id === convId)?.scopes ?? []),
    [conversations]
  )

  const activeScopes = scopesFor(activeConversationId)

  const addScope = useCallback(async () => {
    const folder = await window.rue.scope.pickFolder()
    if (!folder) return
    let convId = activeConversationId
    if (convId === null) {
      const conv = await window.rue.history.create('New conversation')
      convId = conv.id
      setActiveConversationId(convId)
    }
    const current = conversations.find(c => c.id === convId)?.scopes ?? []
    if (current.includes(folder)) return
    await window.rue.history.setScopes(convId, [...current, folder])
    await refreshConversations()
  }, [activeConversationId, conversations, refreshConversations])

  const removeScope = useCallback(
    async (path: string) => {
      if (activeConversationId === null) return
      const current = conversations.find(c => c.id === activeConversationId)?.scopes ?? []
      await window.rue.history.setScopes(
        activeConversationId,
        current.filter(p => p !== path)
      )
      await refreshConversations()
    },
    [activeConversationId, conversations, refreshConversations]
  )

  const addAttachment = useCallback(
    (a: Attachment) => setAttachments(prev => [...prev, a.uid ? a : { ...a, uid: attachmentUid() }]),
    []
  )
  const removeAttachment = useCallback((idx: number) => setAttachments(prev => prev.filter((_, i) => i !== idx)), [])

  const captureScreen = useCallback(async () => {
    if (!settings) return
    setStatus('Capturing screen…')
    try {
      const shot = await window.rue.captureScreenshot()
      if (settings.useOcr) {
        setStatus('Running OCR…')
        const text = await ocrDataUrl(shot.dataUrl)
        addAttachment({ kind: 'screenshot', dataUrl: shot.dataUrl, ocrText: text })
      } else {
        addAttachment({ kind: 'screenshot', dataUrl: shot.dataUrl })
      }
      setStatus(null)
    } catch (err) {
      setStatus(`Screenshot failed: ${(err as Error).message}`)
    }
  }, [settings, addAttachment])

  const captureSelection = useCallback(async () => {
    setStatus('Reading selection…')
    try {
      // Hide Rue so the Cmd+C goes to the previously-focused window.
      await window.rue.hideWindow()
      await new Promise(r => setTimeout(r, 200))
      const sel = await window.rue.captureSelection()
      // Re-show Rue regardless of result so the user sees the outcome.
      await window.rue.showWindow()
      if (!sel.text.trim()) {
        setStatus('No text was selected in the previous window.')
        return
      }
      addAttachment({ kind: 'selection', text: sel.text })
      setStatus(null)
    } catch (err) {
      // Re-show on error too so the user isn't stranded looking at nothing.
      await window.rue.showWindow().catch(() => undefined)
      setStatus(`Selection failed: ${(err as Error).message}`)
    }
  }, [addAttachment])

  const captureWeb = useCallback(async (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return
    setStatus(`Fetching ${trimmed}…`)
    try {
      const page = await window.rue.captureWeb(trimmed)
      addAttachment({ kind: 'web', url: page.url, title: page.title, text: page.text })
      setStatus(null)
    } catch (err) {
      setStatus(`Fetch failed: ${(err as Error).message}`)
    }
  }, [addAttachment])

  const attachImageFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = () => addAttachment({ kind: 'screenshot', dataUrl: reader.result as string })
      reader.readAsDataURL(file)
    },
    [addAttachment]
  )

  const attachPdfFile = useCallback(
    async (file: File) => {
      setStatus(`Extracting ${file.name}…`)
      try {
        const ext = await extractPdfText(file)
        addAttachment({ kind: 'pdf', name: ext.name, text: ext.text })
        setStatus(null)
      } catch (err) {
        setStatus(`PDF failed: ${(err as Error).message}`)
      }
    },
    [addAttachment]
  )

  /** Route a batch of dropped / picked files to the right attachment kind. */
  const attachFiles = useCallback(
    (files: FileList | ReadonlyArray<File>) => {
      for (const file of Array.from(files)) {
        if (file.type.startsWith('image/')) {
          attachImageFile(file)
        } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          void attachPdfFile(file)
        } else {
          setStatus(`Unsupported file type: ${file.name}`)
        }
      }
    },
    [attachImageFile, attachPdfFile]
  )

  const toggleVoice = useCallback(() => {
    if (voiceSessionRef.current) {
      // Stop recording — transcription runs on-device and lands asynchronously.
      voiceSessionRef.current.stop()
      voiceSessionRef.current = null
      setVoiceActive(false)
      setStatus('Transcribing…')
      return
    }
    if (!isVoiceSupported()) {
      setStatus('Voice input is not available in this build.')
      return
    }
    setStatus('Listening…')
    setVoiceActive(true)
    voiceSessionRef.current = startDictation(
      (text, isFinal) => {
        if (isFinal) {
          setPrompt(p => (p ? `${p} ${text}` : text))
          setStatus(null)
        }
      },
      msg => {
        setStatus(`Voice error: ${msg}`)
        voiceSessionRef.current = null
        setVoiceActive(false)
      }
    )
  }, [])

  const rateMessage = useCallback(async (messageId: number, rating: Rating) => {
    await window.rue.history.rate(messageId, rating ?? 0)
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, rating } : m)))
  }, [])

  const clearDebugLog = useCallback((): void => setDebugLog([]), [])

  const send = useCallback(async (overrideText?: string) => {
    if (!settings || busy) return
    // `overrideText` lets a fired scheduled task run without touching the composer.
    const text = (overrideText ?? prompt).trim()
    if (!text && attachments.length === 0) return

    // Reject an empty /search up front — before the message is shown.
    if (text.startsWith('/search') && !text.replace(/^\/search\s*/, '').trim()) {
      setStatus('Usage: /search <query>')
      return
    }

    // Show the user's message and clear the composer IMMEDIATELY — before any
    // retrieval or network work — so pressing Enter feels instant. The
    // auto-scroll effect in Conversation follows the new message to the
    // bottom. All the slow work happens afterwards, inside the try below.
    const startedAttachments = [...attachments]
    const displayText = text || `[${startedAttachments.map(describeAttachment).join(', ')}]`
    const now = Date.now()
    setMessages(prev => [
      ...prev,
      { role: 'user', text: displayText, createdAt: now },
      { role: 'assistant', text: '', streaming: true, createdAt: now }
    ])
    setPrompt('')
    setAttachments([])
    setBusy(true)
    setWaitingForFirstToken(true)
    setStatus(null)
    const ac = new AbortController()
    abortRef.current = ac

    try {
      let workingPrompt = text
      let workingAttachments = [...startedAttachments]

      if (text.startsWith('/screen')) {
        setStatus('Capturing screen…')
        const shot = await window.rue.captureScreenshot()
        const screenshotAtt: Attachment = settings.useOcr
          ? { kind: 'screenshot', dataUrl: shot.dataUrl, ocrText: await ocrDataUrl(shot.dataUrl) }
          : { kind: 'screenshot', dataUrl: shot.dataUrl }
        workingAttachments = [...workingAttachments, screenshotAtt]
        workingPrompt = text.replace(/^\/screen\s*/, '').trim() || 'Describe what is on my screen.'
        setStatus(null)
      } else if (text.startsWith('/search')) {
        const query = text.replace(/^\/search\s*/, '')
        setStatus(`Searching: ${query}…`)
        const result = await window.rue.search(query)
        workingAttachments = [
          ...workingAttachments,
          { kind: 'web', url: 'search://' + query, title: `Search: ${query}`, text: result.summary }
        ]
        workingPrompt = `Use the search results above to answer: ${query}`
        setStatus(null)
      } else if (parseSlash(text).command) {
        workingPrompt = applySlash(text)
      }

      if (activeNotebook && (workingPrompt || workingAttachments.length > 0)) {
        try {
          const nb = await window.rue.notebook.search(
            activeNotebook.id,
            workingPrompt || workingAttachments.map(describeAttachment).join(' ')
          )
          if (nb.contextText.trim()) {
            workingAttachments = [
              ...workingAttachments,
              {
                kind: 'web',
                url: `notebook://${activeNotebook.name}`,
                title: `Notebook: ${activeNotebook.name}`,
                text: nb.contextText
              }
            ]
          }
        } catch (err) {
          setStatus(`Notebook search failed: ${(err as Error).message}`)
        }
      }

      // Per-chat folder scopes — plus, when self-healing is on, Rue's own
      // source and reference paths, so the agent's file tools can repair them.
      const baseScopes = scopesFor(activeConversationId)
      const healScopes =
        settings.selfHealing
          ? [settings.sourceCodePath, settings.referencesPath].filter(p => p.trim() !== '')
          : []
      const scopes = [...baseScopes, ...healScopes]
      if (scopes.length > 0 && (workingPrompt || workingAttachments.length > 0)) {
        try {
          const ctx = await window.rue.scope.search(
            scopes,
            workingPrompt || workingAttachments.map(describeAttachment).join(' ')
          )
          if (ctx.trim()) {
            workingAttachments = [
              ...workingAttachments,
              { kind: 'web', url: 'scope://folders', title: 'Folder scope', text: ctx }
            ]
          }
        } catch (err) {
          setStatus(`Folder scope search failed: ${(err as Error).message}`)
        }
      }

      // One registry per turn: built-in + MCP + skills + Task + Agent tools.
      const askConfirm = async (reason: string): Promise<boolean> => window.confirm(reason)
      const spawn = createSpawner({
        builtinTools,
        mcpTools,
        skills,
        settings,
        scopes,
        signal: ac.signal,
        confirm: askConfirm
      })
      const registry = buildRegistry(builtinTools, mcpTools, skills, { spawn, includeTaskTools: true })

      // Inject the temporal-memory index so the model knows what it has saved.
      const memoryIndex = await window.rue.memory.index().catch(() => '')
      const memorySection = memoryIndex
        ? `\n\n## Saved memory\nMemories from past sessions — read one with MemoryRead when its description looks relevant:\n${memoryIndex}`
        : ''

      const userMsg = buildUserMessage(workingPrompt, workingAttachments)
      const baseHistory: ChatMessage[] = [
        {
          role: 'system',
          content:
            `${settings.systemPrompt}${AGENT_ADDENDUM}${MEMORY_NOTE}${memorySection}` +
            `${registry.hasDeferredTools() ? TOOLSEARCH_NOTE : ''}` +
            `${
              settings.selfHealing && settings.sourceCodePath
                ? selfHealingAddendum(settings.sourceCodePath, settings.referencesPath)
                : ''
            }`
        },
        ...history.filter(m => m.role !== 'system'),
        userMsg
      ]

      let convId = activeConversationId
      if (convId === null) {
        const title = text.slice(0, 40) || `Chat ${new Date().toLocaleTimeString()}`
        const conv = await window.rue.history.create(title)
        convId = conv.id
        setActiveConversationId(convId)
        await refreshConversations()
      }
      await window.rue.history.append(convId, 'user', displayText)

      const queryResult = await runQuery(
        {
          messages: baseHistory,
          registry,
          settings,
          scopes,
          signal: ac.signal,
          confirm: askConfirm
        },
        {
          onAssistantText: (text, streaming) =>
            setMessages(prev => patchLastAssistant(prev, text, streaming)),
          onToolEvent: event => patchToolEvent(setMessages, event),
          onStatus: setStatus,
          onFirstToken: () => setWaitingForFirstToken(false),
          // Debug mode: stream the loop trace into state + the on-disk log.
          onDebug: settings.debugMode
            ? entry => {
                setDebugLog(prev => [...prev, entry].slice(-300))
                void window.rue.debug.log(JSON.stringify(entry))
              }
            : undefined
        }
      )
      const finalText = queryResult.text

      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { ...next[next.length - 1], role: 'assistant', text: finalText, streaming: false }
        return next
      })
      setHistory([...baseHistory, { role: 'assistant', content: finalText }])
      const stored = await window.rue.history.append(convId, 'assistant', finalText)
      setMessages(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last) next[next.length - 1] = { ...last, id: stored.id, rating: null }
        return next
      })
      await refreshConversations()
    } catch (err) {
      const msg =
        err instanceof OpenRouterError || err instanceof AnthropicError || err instanceof OllamaError
          ? err.message
          : (err as Error).message
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { ...next[next.length - 1], role: 'error', text: msg, streaming: false }
        return next
      })
    } finally {
      setBusy(false)
      setWaitingForFirstToken(false)
      abortRef.current = null
    }
  }, [
    settings,
    busy,
    prompt,
    attachments,
    history,
    activeNotebook,
    activeConversationId,
    mcpTools,
    builtinTools,
    skills,
    refreshConversations,
    scopesFor
  ])

  // A fired scheduled task runs as a fresh prompt — but only while idle, so it
  // never interrupts an in-flight response. Recurring tasks simply fire again.
  useEffect(() => {
    return window.rue.onScheduleFire(({ prompt: scheduledPrompt }) => {
      if (!busy) void send(scheduledPrompt)
    })
  }, [busy, send])

  const stop = useCallback((): void => {
    abortRef.current?.abort()
    setMessages(prev => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last && last.role === 'assistant' && last.streaming) {
        next[next.length - 1] = { ...last, streaming: false, text: last.text || '_(stopped)_' }
      }
      return next
    })
    setBusy(false)
    setWaitingForFirstToken(false)
    setStatus(null)
  }, [])

  const regenerate = useCallback(async (): Promise<void> => {
    if (busy || messages.length < 2) return
    // Drop the last assistant + restore the user prompt back into the field.
    const last = messages[messages.length - 1]
    const prevUser = messages[messages.length - 2]
    if (!last || last.role !== 'assistant' || !prevUser || prevUser.role !== 'user') return

    setMessages(prev => prev.slice(0, -2))
    setHistory(prev => prev.slice(0, -2))
    setPrompt(prevUser.text)
  }, [busy, messages])

  return {
    settings,
    conversations,
    notebooks,
    activeConversationId,
    activeNotebook,
    messages,
    attachments,
    prompt,
    busy,
    status,
    voiceActive,
    mcpTools,
    waitingForFirstToken,
    debugLog,
    setPrompt,
    setActiveNotebook,
    updateSettings,
    resetAllSettings,
    refreshNotebooks,
    selectConversation,
    newConversation,
    deleteConversation,
    renameConversation,
    activeScopes,
    addScope,
    removeScope,
    addAttachment,
    removeAttachment,
    captureScreen,
    captureSelection,
    captureWeb,
    attachImageFile,
    attachPdfFile,
    attachFiles,
    toggleVoice,
    send,
    stop,
    regenerate,
    rateMessage,
    clearDebugLog
  }
}

/** Append or update (by id) a tool event on the in-flight assistant message. */
function patchToolEvent(
  setMessages: React.Dispatch<React.SetStateAction<ReadonlyArray<DisplayMessage>>>,
  event: ToolEvent
): void {
  setMessages(prev => {
    const next = [...prev]
    const last = next[next.length - 1]
    if (!last) return prev
    const events = [...(last.toolEvents ?? [])]
    const idx = events.findIndex(e => e.id === event.id)
    if (idx >= 0) events[idx] = event
    else events.push(event)
    next[next.length - 1] = { ...last, toolEvents: events }
    return next
  })
}

/** Replace the trailing assistant message's text + streaming flag. */
function patchLastAssistant(
  prev: ReadonlyArray<DisplayMessage>,
  text: string,
  streaming: boolean
): ReadonlyArray<DisplayMessage> {
  const next = [...prev]
  const last = next[next.length - 1]
  if (!last) return prev
  next[next.length - 1] = { ...last, role: 'assistant', text, streaming }
  return next
}
