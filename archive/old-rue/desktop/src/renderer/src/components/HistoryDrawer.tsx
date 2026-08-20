import { motion } from 'framer-motion'
import { Button, ScrollArea } from '@super-repo/ui'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import type { Conversation } from '../../../preload/index.js'
import { SHELL } from '../lib/motion.js'
import rueMark from '../../../../resources@multiterm/rue-mark.svg'

interface HistoryDrawerProps {
  readonly conversations: ReadonlyArray<Conversation>
  readonly activeId: number | null
  /** Conversation currently generating a response — shows a spinner by its name. */
  readonly thinkingId: number | null
  readonly onSelect: (id: number) => void
  readonly onNew: () => void
  readonly onDelete: (id: number) => void | Promise<void>
  readonly onClose: () => void
}

export function HistoryDrawer({
  conversations,
  activeId,
  thinkingId,
  onSelect,
  onNew,
  onDelete,
  onClose
}: HistoryDrawerProps) {
  return (
    <>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-30 bg-background/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="drawer"
        initial={{ x: -260 }}
        animate={{ x: 0 }}
        exit={{ x: -260 }}
        transition={SHELL}
        className="absolute bottom-0 left-0 top-0 z-40 flex w-64 flex-col border-r border-border bg-popover"
      >
        {/* Header — Rue logo + wordmark, and the close control. */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-white">
              <img src={rueMark} alt="" draggable={false} className="size-[80%] object-contain" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">Rue</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="no-drag size-7 text-muted-foreground hover:text-foreground"
            title="Close"
            aria-label="Close"
          >
            <X />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {/* Chats group — label + new-chat control. */}
            <div className="flex items-center justify-between px-1 py-1">
              <span className="section-heading" style={{ marginBottom: 0 }}>
                Chats
              </span>
              <button
                type="button"
                onClick={onNew}
                title="New chat (⌘N)"
                aria-label="New chat"
                className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-0.5">
              {conversations.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">No chats yet</div>
              ) : (
                conversations.map(c => (
                  <div
                    key={c.id}
                    className={`group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent ${
                      c.id === activeId ? 'bg-accent text-accent-foreground' : ''
                    }`}
                    onClick={() => onSelect(c.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c.id === thinkingId && (
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-label="Thinking" />
                    )}
                    <button
                      type="button"
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      onClick={e => {
                        e.stopPropagation()
                        onDelete(c.id)
                      }}
                      aria-label="Delete chat"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </ScrollArea>
      </motion.div>
    </>
  )
}
