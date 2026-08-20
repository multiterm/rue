import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { motion } from 'framer-motion'
import { Button } from '@super-repo/ui'
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import 'katex/dist/katex.min.css'
import { INLINE } from '../lib/motion.js'
import { estimateTokens } from '../lib/tokens.js'
import type { ToolEvent } from '../lib/toolEvents.js'
import { ToolCard } from './ToolCard.js'

export type MessageRole = 'user' | 'assistant' | 'error'
export type Rating = 1 | -1 | null

interface MessageProps {
  readonly role: MessageRole
  readonly text: string
  readonly streaming?: boolean
  readonly rating?: Rating
  readonly canRegenerate?: boolean
  readonly createdAt?: number
  readonly toolEvents?: ReadonlyArray<ToolEvent>
  readonly onRate?: (rating: Rating) => void
  readonly onRegenerate?: () => void
}

// Shared styling for the gutter action buttons. `[&_svg]:size-3.5` shrinks the
// icon from the Button base's default 16px so it isn't cramped at 28px.
const MSG_ACTION_BTN = 'size-7 text-muted-foreground hover:text-foreground [&_svg]:size-3.5'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * A chat message: the styled bubble plus, for assistant messages, a fixed
 * "gutter" row beneath it. The gutter's height is always reserved (so the
 * layout never shifts), but its contents — action buttons and the
 * timestamp / token metadata — only become visible while the message is
 * hovered (hovering the bubble OR the gutter counts).
 *
 * Streaming bubbles skip framer-motion's `layout` prop: re-running FLIP on
 * every token visibly stutters long responses.
 */
function MessageInner({
  role,
  text,
  streaming,
  rating = null,
  canRegenerate,
  createdAt,
  toolEvents,
  onRate,
  onRegenerate
}: MessageProps) {
  const [copied, setCopied] = useState(false)

  const align =
    role === 'user'
      ? 'items-end self-end'
      : role === 'error'
        ? 'items-stretch self-stretch'
        : 'items-start self-start'
  const klass =
    role === 'user'
      ? 'chat-bubble chat-bubble-user'
      : role === 'error'
        ? 'chat-bubble chat-bubble-error'
        : 'chat-bubble chat-bubble-ai'

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={INLINE}
      className={`group flex max-w-[92%] flex-col gap-1 ${align}`}
    >
      {role === 'assistant' && toolEvents && toolEvents.length > 0 && (
        <div className="flex w-[440px] max-w-full flex-col gap-1">
          {toolEvents.map(ev => (
            <ToolCard key={ev.id} event={ev} />
          ))}
        </div>
      )}

      <div className={`${klass} rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed select-text`}>
        {role === 'assistant' ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeHighlight, rehypeKatex]}>
              {text || '​'}
            </ReactMarkdown>
            {streaming && text && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-primary/70 align-text-bottom" />
            )}
          </div>
        ) : (
          <span className="whitespace-pre-wrap">{text}</span>
        )}
      </div>

      {/* Gutter — fixed height so revealing it never shifts layout. */}
      {role === 'assistant' && (
        <div className="flex h-7 items-center gap-0.5 pl-1 opacity-0 transition-opacity group-hover:opacity-100">
          {!streaming && text && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className={MSG_ACTION_BTN}
                onClick={() => void copy()}
                aria-label="Copy"
                title={copied ? 'Copied' : 'Copy'}
              >
                {copied ? <Check className="text-primary" /> : <Copy />}
              </Button>
              {onRegenerate && canRegenerate && (
                <Button
                  size="icon"
                  variant="ghost"
                  className={MSG_ACTION_BTN}
                  onClick={onRegenerate}
                  aria-label="Regenerate"
                  title="Regenerate"
                >
                  <RefreshCw />
                </Button>
              )}
              {onRate && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`${MSG_ACTION_BTN} ${rating === 1 ? 'text-primary hover:text-primary' : ''}`}
                    onClick={() => onRate(rating === 1 ? null : 1)}
                    aria-label="Helpful"
                    title="Helpful"
                  >
                    <ThumbsUp />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`${MSG_ACTION_BTN} ${rating === -1 ? 'text-destructive hover:text-destructive' : ''}`}
                    onClick={() => onRate(rating === -1 ? null : -1)}
                    aria-label="Not helpful"
                    title="Not helpful"
                  >
                    <ThumbsDown />
                  </Button>
                </>
              )}
              <span className="ml-1.5 flex items-center gap-2 tabular-nums text-[10px] text-muted-foreground">
                {createdAt && <span>{formatTime(createdAt)}</span>}
                <span>{estimateTokens(text)} tokens</span>
              </span>
            </>
          )}
        </div>
      )}
    </motion.div>
  )
}

/**
 * Memoize on shallow props. During streaming only the LAST bubble's `text`
 * changes — every prior bubble bails out of render entirely.
 */
export const Message = memo(MessageInner, (prev, next) => {
  return (
    prev.role === next.role &&
    prev.text === next.text &&
    prev.streaming === next.streaming &&
    prev.rating === next.rating &&
    prev.canRegenerate === next.canRegenerate &&
    prev.createdAt === next.createdAt &&
    prev.toolEvents === next.toolEvents &&
    prev.onRate === next.onRate &&
    prev.onRegenerate === next.onRegenerate
  )
})
