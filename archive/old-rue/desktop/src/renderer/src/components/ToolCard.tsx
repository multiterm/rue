import { useState } from 'react'
import type { ToolEvent, ToolStatus } from '../lib/toolEvents.js'

/** Result lines shown before the "+N lines" collapse. */
const PREVIEW_LINES = 5
/** Cap on lines rendered when expanded, so huge output can't flood the chat. */
const MAX_LINES = 400

/** Colour of the leading status dot. */
function dotClass(status: ToolStatus): string {
  if (status === 'running') return 'text-primary animate-pulse'
  if (status === 'error') return 'text-destructive'
  return 'text-emerald-400'
}

/** Diff-aware colour for a single result line. */
function lineClass(line: string, isError: boolean): string {
  if (isError) return 'text-destructive/90'
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-emerald-400'
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-rose-400'
  if (line.startsWith('@@')) return 'text-primary'
  return 'text-muted-foreground'
}

/**
 * A single agentic tool call, rendered as a Claude-Code-style transcript
 * entry: a `●` header line with the tool + arguments, and a `⎿` result block
 * collapsed to {@link PREVIEW_LINES} lines with a "+N lines" expander.
 */
export function ToolCard({ event }: { event: ToolEvent }) {
  const [expanded, setExpanded] = useState(false)
  const isError = event.status === 'error'
  const detail = event.detail ?? ''
  const allLines = detail ? detail.split('\n') : []
  const truncated = allLines.length > PREVIEW_LINES
  const shown = expanded ? allLines.slice(0, MAX_LINES) : allLines.slice(0, PREVIEW_LINES)
  const hidden = allLines.length - shown.length

  return (
    <div className="font-mono text-[12px] leading-relaxed">
      {/* ● ToolName(args…) */}
      <div className="flex items-baseline gap-1.5">
        <span className={`shrink-0 ${dotClass(event.status)}`}>●</span>
        <span className="min-w-0 break-all text-foreground/90">
          {event.title}
          {event.status === 'running' && <span className="text-muted-foreground"> …</span>}
        </span>
      </div>

      {/* ⎿ result */}
      {(shown.length > 0 || event.summary) && (
        <div className="flex gap-1.5 pl-1">
          <span className="shrink-0 select-none text-muted-foreground/60">⎿</span>
          <div className="min-w-0 flex-1">
            {shown.length > 0 ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">
                {shown.map((line, i) => (
                  <div key={i} className={lineClass(line, isError)}>
                    {line || ' '}
                  </div>
                ))}
              </pre>
            ) : (
              <span className={isError ? 'text-destructive/90' : 'text-muted-foreground'}>
                {event.summary}
              </span>
            )}
            {truncated && (
              <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                {expanded
                  ? '… show less'
                  : `… +${hidden} line${hidden === 1 ? '' : 's'} (click to expand)`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
