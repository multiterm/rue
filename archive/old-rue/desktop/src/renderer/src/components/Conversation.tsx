import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DisplayMessage } from '../hooks/useRueState.js'
import { Message, type Rating } from './Message.js'

const THINKING_VERBS = [
  'Pondering',
  'Noodling',
  'Percolating',
  'Ruminating',
  'Cogitating',
  'Mulling',
  'Brewing',
  'Conjuring',
  'Tinkering',
  'Marinating',
  'Untangling',
  'Scheming'
] as const

/** Elapsed seconds → "54s" / "2m 37s". */
function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

interface ConversationProps {
  readonly messages: ReadonlyArray<DisplayMessage>
  readonly busy: boolean
  readonly waitingForFirstToken: boolean
  readonly activeNotebookName?: string
  readonly onRate: (messageId: number, rating: Rating) => Promise<void>
  readonly onRegenerate: () => Promise<void>
}

export function Conversation({ messages, busy, waitingForFirstToken, activeNotebookName, onRate, onRegenerate }: ConversationProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)

  // Whimsical "thinking" label + elapsed timer while waiting for the first
  // token. A fresh verb is picked per turn.
  const [thinkingSecs, setThinkingSecs] = useState(0)
  const [thinkingVerb, setThinkingVerb] = useState<string>(THINKING_VERBS[0])
  useEffect(() => {
    if (!waitingForFirstToken) return
    setThinkingSecs(0)
    setThinkingVerb(THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)] ?? 'Thinking')
    const start = Date.now()
    const t = setInterval(() => setThinkingSecs(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(t)
  }, [waitingForFirstToken])

  // Auto-scroll lock: only follow the tail if the user is already at (or near)
  // the bottom. If they scrolled up to read history, stop hijacking their view.
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !stickToBottom) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, stickToBottom])

  function onScroll(): void {
    const el = viewportRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setStickToBottom(atBottom)
  }

  // Suppress the trailing empty assistant placeholder while we're still waiting
  // for the first token — otherwise the user sees an empty bubble AND the
  // separate "Thinking…" pill below it, which reads as a duplicate indicator.
  const visibleMessages =
    waitingForFirstToken &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages[messages.length - 1]?.text === ''
      ? messages.slice(0, -1)
      : messages

  const lastAssistantIdx =
    visibleMessages.length - 1 - [...visibleMessages].reverse().findIndex(m => m.role === 'assistant')
  const canRegenerate =
    !busy && visibleMessages.length >= 2 && visibleMessages[visibleMessages.length - 1]?.role === 'assistant'

  return (
    // The scroller itself is flex-1 and bounded by the chat surface's fixed
    // height, so it scrolls internally instead of pushing the ask-bar off the
    // window. The inner track is `min-h-full justify-end` so a short
    // conversation sits at the bottom and the newest message is always
    // visible above the input.
    <div ref={viewportRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col justify-end gap-3.5 px-4 py-4">
        {visibleMessages.length === 0 && !waitingForFirstToken ? (
          <div className="m-auto mt-12 text-center text-sm text-muted-foreground select-text">
            Ask anything. Type <code className="text-primary">/</code> for commands.
            {activeNotebookName && (
              <div className="mt-1 text-accent-foreground">Notebook: {activeNotebookName}</div>
            )}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {visibleMessages.map((m, i) => (
              // Keyed by index, not m.id: a streaming bubble has no id until
              // it's persisted, and switching `pending-N` → the real id would
              // remount the bubble and replay its entrance animation. Messages
              // are only ever appended or truncated from the end, so the index
              // is a stable identity here.
              <Message
                key={i}
                role={m.role}
                text={m.text}
                streaming={m.streaming}
                rating={m.rating ?? null}
                createdAt={m.createdAt}
                toolEvents={m.toolEvents}
                canRegenerate={i === lastAssistantIdx && canRegenerate}
                onRate={m.id ? r => void onRate(m.id!, r) : undefined}
                onRegenerate={onRegenerate}
              />
            ))}
          </AnimatePresence>
        )}

        <AnimatePresence>
          {waitingForFirstToken && (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="self-start flex items-center gap-2 rounded-2xl bg-card border border-border px-3.5 py-2 text-xs text-muted-foreground"
            >
              <div className="flex gap-1">
                <motion.span
                  className="size-1.5 rounded-full bg-muted-foreground"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                />
                <motion.span
                  className="size-1.5 rounded-full bg-muted-foreground"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                />
                <motion.span
                  className="size-1.5 rounded-full bg-muted-foreground"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                />
              </div>
              <span>
                {thinkingVerb}…
                {thinkingSecs > 0 && (
                  <span className="ml-1 tabular-nums text-foreground/70">({formatElapsed(thinkingSecs)})</span>
                )}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
