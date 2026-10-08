import { Button } from '../button/index.js'
import { useEffect, useState, type ReactNode, type ComponentProps } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy, LoaderCircle } from 'lucide-react'
import { Scrollbar } from '../scrollbar/index.js'
import { cn } from '../_utils/cn.js'
import './chat.css'

export function CopyButton({ text, label = 'Copy message' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false), [failed, setFailed] = useState(false)
  useEffect(() => { setCopied(false); setFailed(false) }, [text])
  return <Button variant="bare" type="button" className="rue-copy-button" aria-label={label} title={failed ? 'Clipboard unavailable. Select and copy the text.' : copied ? 'Copied' : label} onClick={() => { if (!navigator.clipboard) { setFailed(true); return } void navigator.clipboard.writeText(text).then(() => { setCopied(true); setFailed(false) }).catch(() => setFailed(true)) }}>{copied ? <Check size={14}/> : <Copy size={14}/>}<span>{failed ? 'Select text to copy' : copied ? 'Copied' : 'Copy'}</span></Button>
}
function codeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(codeText).join('')
  if (node && typeof node === 'object' && 'props' in node) return codeText((node.props as { children?: ReactNode }).children)
  return ''
}
function CodeBlock({ children }: ComponentProps<'pre'>) {
  return <div className="rue-code-block"><div className="rue-code-toolbar"><span>Code</span><CopyButton text={codeText(children)} label="Copy code"/></div><Scrollbar className="rue-code-scroll"><pre>{children}</pre></Scrollbar></div>
}
/** No raw HTML, script URLs, embeds or automatic remote image requests. */
export function Markdown({ text }: { text: string }) {
  return <div className="rue-markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} urlTransform={defaultUrlTransform} components={{
    pre: CodeBlock,
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span className="rue-image-placeholder">[Image: {alt || 'external image not loaded'}]</span>,
    table: ({ children }) => <Scrollbar className="rue-table-scroll"><table>{children}</table></Scrollbar>,
  }}>{text}</ReactMarkdown></div>
}
export function ThinkingIndicator({ label = 'Working…' }: { label?: string }) {
  return <div role="status" className="rue-thinking"><LoaderCircle size={16} aria-hidden="true"/><span>{label}</span></div>
}
export function Skeleton({ className, ...props }: ComponentProps<'div'>) { return <div aria-hidden="true" {...props} className={cn('rue-skeleton rounded-lg bg-surface-2', className)}/> }
export function ChatSkeleton() { return <div role="status" aria-label="Loading conversation" className="rue-chat-skeleton"><Skeleton className="h-12 w-2/3 self-end"/><Skeleton className="h-24 w-4/5"/><Skeleton className="h-12 w-1/2 self-end"/></div> }
