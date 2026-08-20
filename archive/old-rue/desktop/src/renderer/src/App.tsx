import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Paperclip } from 'lucide-react'
import { AskBar } from './components/AskBar.js'
import { ChatHeader } from './components/ChatHeader.js'
import { Conversation } from './components/Conversation.js'
import { DebugPanel } from './components/DebugPanel.js'
import { TipBar } from './components/TipBar.js'
import { SettingsOverlay } from './components/SettingsOverlay.js'
import { HistoryDrawer } from './components/HistoryDrawer.js'
import { Welcome } from './components/Welcome.js'
import { PairingPanel } from './components/PairingPanel.js'
import { useRueState } from './hooks/useRueState.js'
import { useAutoResize } from './hooks/useAutoResize.js'
import { INLINE, SHELL } from './lib/motion.js'
import { estimateConversationTokens } from './lib/tokens.js'

type Mode = 'welcome' | 'bar' | 'chat' | 'settings' | 'connect'

export function App() {
  const rue = useRueState()
  const [mode, setMode] = useState<Mode>('bar')
  const [historyOpen, setHistoryOpen] = useState(false)
  const prevModeRef = useRef<Mode>('bar')
  // Rue is a normal resizable window — its size belongs to the user, not
  // the current mode. No auto-resize; bar/chat/settings all render at the
  // window's current size.
  const shellRef = useAutoResize<HTMLDivElement>(false)

  // Window-wide file drag-and-drop. A depth counter avoids the flicker from
  // dragenter/dragleave firing as the cursor crosses child elements.
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  function hasFiles(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes('Files')
  }
  function onDragEnter(e: React.DragEvent): void {
    if (mode === 'welcome' || !hasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }
  function onDragOver(e: React.DragEvent): void {
    if (mode !== 'welcome' && hasFiles(e)) e.preventDefault()
  }
  function onDragLeave(e: React.DragEvent): void {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  function onDrop(e: React.DragEvent): void {
    if (mode === 'welcome' || !hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (e.dataTransfer.files.length === 0) return
    rue.attachFiles(e.dataTransfer.files)
    // Surface the composer so the new attachments are visible.
    if (mode === 'settings') setMode(rue.messages.length > 0 ? 'chat' : 'bar')
  }

  // Once settings have loaded, enter welcome flow if onboarding isn't done.
  useEffect(() => {
    if (rue.settings && !rue.settings.onboardingComplete && mode === 'bar' && rue.messages.length === 0) {
      setMode('welcome')
    }
  }, [rue.settings, rue.messages.length, mode])

  // Only the welcome screen sizes/centres the window (first-run framing).
  // Switching between bar, chat, and settings keeps the user's current window
  // size — Rue is a resizable app window, not a mode-snapped overlay.
  useEffect(() => {
    if (mode !== prevModeRef.current) {
      prevModeRef.current = mode
      if (mode === 'welcome') void window.rue.setWindowMode('welcome')
    }
  }, [mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (historyOpen) setHistoryOpen(false)
        else if (mode === 'settings' || mode === 'connect')
          setMode(rue.messages.length > 0 ? 'chat' : 'bar')
        else void window.rue.hideWindow()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setMode(m => (m === 'settings' ? (rue.messages.length > 0 ? 'chat' : 'bar') : 'settings'))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !e.shiftKey) {
        e.preventDefault()
        void rue.newConversation()
        setHistoryOpen(false)
        setMode('bar')
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        setMode(m => (m === 'connect' ? (rue.messages.length > 0 ? 'chat' : 'bar') : 'connect'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [historyOpen, mode, rue.messages.length])

  // Auto-expand to the chat surface once a conversation has messages. This
  // only ever PROMOTES bar → chat; it never auto-collapses. Returning to the
  // bar is always explicit (new conversation, deleting the active chat) — so
  // an intentionally-opened empty chat ("Open Agent Window") stays put.
  useEffect(() => {
    if (mode === 'bar' && rue.messages.length > 0) setMode('chat')
  }, [rue.messages.length, mode])

  // Tray "Chats" → jump straight to the expanded chat surface.
  useEffect(() => {
    return window.rue.onOpenChat(() => {
      setHistoryOpen(false)
      setMode('chat')
    })
  }, [])

  // Tray "Preferences…" → jump straight to Settings.
  useEffect(() => {
    return window.rue.onOpenSettings(() => {
      setHistoryOpen(false)
      setMode('settings')
    })
  }, [])

  // Apply the saved theme mode + accent color to the document root. tokens.css
  // keys its palettes off `data-theme`; `--primary` is written inline so a
  // custom accent overrides the token default. (SettingsOverlay previews
  // unsaved changes on top of this while the panel is open.)
  useEffect(() => {
    if (!rue.settings) return
    const root = document.documentElement
    root.dataset.theme = rue.settings.theme
    root.style.setProperty('--primary', rue.settings.accentColor)
  }, [rue.settings])

  // Opening the chat list always expands the window — the history drawer is
  // sized for the expanded surface, not the compact bar.
  const openHistory = (): void => {
    setHistoryOpen(true)
    setMode('chat')
  }

  if (!rue.settings) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading…</div>
  }

  return (
    <motion.div
      key="shell"
      ref={shellRef}
      initial={{ opacity: 0, y: -6, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={SHELL}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`morphing-container ${mode === 'bar' ? 'morphing-bar' : 'morphing-chat'} relative flex h-full flex-col overflow-hidden`}
    >
      {/* Invisible drag handle along the very top edge */}
      <div className="drag absolute top-0 left-0 right-0 h-3 z-0" />

      {/* File drag-and-drop overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/60 px-10 py-7 text-sm font-medium text-foreground">
              <Paperclip className="size-6 text-primary" />
              Drop files to attach
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Welcome / Conversation / settings surface — only rendered when expanded */}
      <AnimatePresence mode="wait">
        {mode === 'welcome' && rue.settings && (
          <Welcome
            key="welcome"
            settings={rue.settings}
            onChange={rue.updateSettings}
            onComplete={() => setMode('bar')}
          />
        )}
        {mode === 'chat' && (
          <motion.div
            key="conversation"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={INLINE}
            className="flex-1 min-h-0 flex flex-col"
          >
            <ChatHeader
              title={rue.conversations.find(c => c.id === rue.activeConversationId)?.title ?? ''}
              tokenCount={estimateConversationTokens(rue.messages.map(m => m.text))}
              onRename={t => {
                if (rue.activeConversationId) void rue.renameConversation(rue.activeConversationId, t)
              }}
              onNewChat={() => {
                void rue.newConversation()
                setHistoryOpen(false)
                setMode('bar')
              }}
              onOpenHistory={openHistory}
              onOpenSettings={() => setMode('settings')}
              scopes={rue.activeScopes}
              onAddScope={() => void rue.addScope()}
              onRemoveScope={path => void rue.removeScope(path)}
            />
            <Conversation
              messages={rue.messages}
              busy={rue.busy}
              waitingForFirstToken={rue.waitingForFirstToken}
              onRate={rue.rateMessage}
              onRegenerate={rue.regenerate}
              activeNotebookName={rue.activeNotebook?.name}
            />
            {rue.settings.debugMode && (
              <DebugPanel entries={rue.debugLog} onClear={rue.clearDebugLog} />
            )}
          </motion.div>
        )}
        {mode === 'settings' && rue.settings && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={INLINE}
            className="flex-1 min-h-0"
          >
            <SettingsOverlay
              settings={rue.settings}
              onChange={rue.updateSettings}
              onReset={async () => {
                await rue.resetAllSettings()
                // Go straight to the Welcome flow. We can't drop to 'bar' and
                // let the onboarding effect promote it — the "snap to
                // bar/chat" effect below runs later in the same commit and
                // would clobber 'welcome' back to 'bar'.
                setMode('welcome')
              }}
              notebooks={rue.notebooks}
              onNotebooksChange={rue.refreshNotebooks}
              onClose={() => setMode(rue.messages.length > 0 ? 'chat' : 'bar')}
            />
          </motion.div>
        )}
        {mode === 'connect' && (
          <PairingPanel
            key="connect"
            onClose={() => setMode(rue.messages.length > 0 ? 'chat' : 'bar')}
          />
        )}
      </AnimatePresence>

      {/* Bar mode: a spacer pushes the ask-bar to the bottom of the window. */}
      {mode === 'bar' && <div className="flex-1" />}

      {/* Tip bar — only in idle ask-bar mode, sits just above the ask bar. */}
      <AnimatePresence>
        {mode === 'bar' && !rue.busy && rue.prompt.length === 0 && <TipBar />}
      </AnimatePresence>

      {/* Persistent ask bar — hidden during welcome flow */}
      {mode !== 'welcome' && mode !== 'settings' && mode !== 'connect' && (
      <AskBar
        compact={mode === 'bar'}
        settings={rue.settings}
        attachments={rue.attachments}
        prompt={rue.prompt}
        onPromptChange={rue.setPrompt}
        onAddAttachment={rue.addAttachment}
        onAttachFiles={rue.attachFiles}
        onRemoveAttachment={rue.removeAttachment}
        onSend={rue.send}
        onStop={rue.stop}
        onScreen={rue.captureScreen}
        onSelection={rue.captureSelection}
        onWeb={rue.captureWeb}
        onVoiceToggle={rue.toggleVoice}
        voiceActive={rue.voiceActive}
        busy={rue.busy}
        status={rue.status}
        onOpenHistory={openHistory}
        onOpenSettings={() => setMode('settings')}
        notebooks={rue.notebooks}
        activeNotebook={rue.activeNotebook}
        onSelectNotebook={rue.setActiveNotebook}
      />
      )}

      {/* Agents drawer — absolute overlay over the conversation surface */}
      <AnimatePresence>
        {historyOpen && (
          <HistoryDrawer
            conversations={rue.conversations}
            activeId={rue.activeConversationId}
            thinkingId={rue.busy ? rue.activeConversationId : null}
            onSelect={id => {
              void rue.selectConversation(id)
              setHistoryOpen(false)
              setMode('chat')
            }}
            onNew={() => {
              void rue.newConversation()
              setHistoryOpen(false)
              setMode('bar')
            }}
            onDelete={async id => {
              const wasActive = id === rue.activeConversationId
              await rue.deleteConversation(id)
              if (wasActive) {
                // Active chat gone → close panel, drop back to spotlight
                setHistoryOpen(false)
                setMode('bar')
              }
            }}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
