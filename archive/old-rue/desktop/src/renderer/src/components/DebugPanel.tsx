import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bug, ChevronDown, Trash2 } from 'lucide-react'
import { Button, ScrollArea } from '@super-repo/ui'
import type { DebugEntry } from '../lib/query/index.js'

interface DebugPanelProps {
  readonly entries: ReadonlyArray<DebugEntry>
  readonly onClear: () => void
}

/** Trace-kind → text colour, so turns/tools/recoveries are scannable. */
const KIND_COLOR: Record<DebugEntry['kind'], string> = {
  turn: 'text-primary',
  model: 'text-sky-400',
  tool: 'text-amber-400',
  recovery: 'text-destructive',
  terminal: 'text-muted-foreground'
}

/**
 * Collapsible loop-trace panel docked at the bottom of the chat. Rendered only
 * when debug mode is enabled; shows the {@link DebugEntry} stream the query
 * state machine emits.
 */
export function DebugPanel({ entries, onClear }: DebugPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="shrink-0 border-t border-border bg-muted/30">
      <div className="flex h-8 items-center justify-between px-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Bug className="size-3.5" />
          Debug trace
          <span className="rounded bg-muted px-1 tabular-nums">{entries.length}</span>
          <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {entries.length > 0 && (
          <Button size="icon" variant="ghost" onClick={onClear} className="h-6 w-6" title="Clear trace">
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <ScrollArea className="max-h-48">
              <div className="flex flex-col gap-0.5 px-3 pb-3 font-mono text-[10.5px] leading-relaxed">
                {entries.length === 0 ? (
                  <span className="text-muted-foreground">
                    No trace yet — send a message with debug mode on.
                  </span>
                ) : (
                  entries.map((e, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 tabular-nums text-muted-foreground/70">
                        {new Date(e.time).toLocaleTimeString()}
                      </span>
                      <span className="shrink-0 text-muted-foreground/70">t{e.turn}</span>
                      <span className={`shrink-0 ${KIND_COLOR[e.kind]}`}>{e.kind}</span>
                      <span className="min-w-0 break-all text-foreground">
                        {e.message}
                        {e.detail && (
                          <span className="text-muted-foreground/70"> {JSON.stringify(e.detail)}</span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
