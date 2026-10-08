import { memo, useEffect, useRef, useState } from 'react'
import type { RueMessage, RuePart } from '@multiterm/rue-sdk'
import { CopyButton, Markdown } from '@multiterm/rue-ui'

import {PullRequestActions} from './pull-request-actions'
import { ChatAttachment } from './chat-attachment'
import { ToolMessage, parseToolTranscript } from './tool-message'

type ToolIdentity = { id: string; chunk: number }
const toolIdentity = (part: RuePart) => part.payload.tool as ToolIdentity | undefined

export const ChatMessage=memo(function ChatMessage({ message, parts, active = false,botTitle='Assistant' }: { message: RueMessage; parts: RuePart[]; active?: boolean;botTitle?:string }) {
  const root = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) return
    // Touching a non-focusable area need not produce a blur (notably on iOS).
    // Treat an outside tap or leaving the window as deselection as well.
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setFocused(false) }
    const blur = () => setFocused(false)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', blur)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', blur) }
  }, [focused])
  const own = parts.filter(p => p.messageId === message.id && !p.payload.superseded).sort((a, b) => a.seq - b.seq)
  const hasFiles = own.some(p => p.type === 'file')
  const reasoning = own.some(p => p.type === 'reasoning')
  const identify = reasoning ? (part: RuePart) => part.payload.reasoning as ToolIdentity | undefined : toolIdentity
  const identity = own.map(identify).find(Boolean)
  const toolParts = identity ? parts.filter(p => !p.payload.superseded && identify(p)?.id === identity.id).sort((a, b) => identify(a)!.chunk - identify(b)!.chunk) : undefined
  // Large tool snapshots may span multiple transport messages; render one card.
  if (toolParts?.length && toolParts[0]!.messageId !== message.id) return null
  if (!own.length && parts.some(p => p.messageId === message.id && p.payload.superseded)) return null
  const text = (toolParts ?? own).filter(p => p.type === 'text' || p.type === 'reasoning').map(p => String(p.payload.text ?? '')).join('')
  const tool = reasoning ? { name: 'Thinking', status: (toolParts ?? own).some(p => !p.payload.mirrorFinal) ? 'running' : 'completed', args: '', output: text, diff: '', raw: text } : message.role === 'assistant' && message.meta.origin === 'computer' ? parseToolTranscript(text) : undefined
  // Both dashboard-triggered turns and locally initiated Pi replies publish
  // remoteStatus on text snapshots; keep their streaming indicator consistent.
  const status = String(own.find(p => p.payload.remoteStatus)?.payload.remoteStatus ?? '')
  const pending = ['queued', 'claimed', 'running'].includes(status)
  // Older managed runners finalized this diagnostic without an outcome field.
  // Recognize only our exact diagnostic, never arbitrary text containing "error".
  const legacyFailure=message.meta.origin==='computer'&&own.some(p=>p.payload.mirrorFinal===true)&&text.trim()==='The managed runtime could not complete this request. Check the selected model and its explicit AI-key grant.'
  const failed = legacyFailure||['failed', 'rejected', 'cancelled', 'expired', 'interrupted'].includes(status) || own.some(p => p.type === 'error')
  const marker = /^\[(Waiting for computer|Awaiting local approval|Working on computer|Remote run (failed|rejected|cancelled|expired|interrupted))\]$/.test(text) || (pending && text === '…')
  const visibleText = marker ? '' : text
  const title=typeof message.meta.title==='string'&&message.meta.title.trim()?message.meta.title:message.role==='user'?'You':message.role==='system'?'System':botTitle
  const showPending=!failed&&(pending||(active&&!visibleText))
  const delivered=own.some(part=>part.payload.mirrorFinal===true)
  const date = new Date(message.time), validDate = Number.isFinite(date.getTime())
  return <div id={`message-${message.id}`} className={`message-row ${message.role}`}><div ref={root} className="message-with-actions" onPointerDownCapture={() => setFocused(true)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <div className="message-bubble" tabIndex={0} title={focused && validDate ? date.toLocaleString() : undefined}>
      {!tool&&<header className="message-header"><strong className="message-title" title={title}>{title}</strong>{(showPending||failed||status==='completed')&&<div className="message-status"><span className={`run-status-pill ${failed?'error':showPending?'pending':delivered?'received':'complete'}`} role={showPending?'status':undefined} title={delivered&&!failed?'Message received; this does not confirm task success.':undefined}>{failed?'Error':showPending?(status==='queued'?'Pending':status==='claimed'?'Approval needed':'Running'):delivered?'Received':'Complete'}</span></div>}</header>}
      {tool ? <ToolMessage tool={tool} kind={reasoning ? 'thinking' : 'tool'}/> : hasFiles ? own.map(part => part.type === 'file' ? <ChatAttachment key={part.id} part={part}/> : part.type === 'text' ? <Markdown key={part.id} text={String(part.payload.text ?? '')}/> : null) : visibleText && <Markdown text={visibleText}/>}
      {message.role==='assistant'&&!reasoning&&<PullRequestActions text={tool?.output??visibleText}/>}
      {!tool && failed && !legacyFailure && <p role="alert">{status ? `Remote run ${status}.` : 'The bot could not finish its reply.'} Review the error and transcript before retrying.</p>}
      {!hasFiles && !visibleText && !pending && !active && !failed && <span>{message.role === 'assistant' ? 'Response text unavailable.' : '…'}</span>}
    </div>
    {focused && <div className="message-actions"><span>{reasoning ? 'Thinking' : message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : 'System'}</span>{validDate && <time dateTime={date.toISOString()} title={date.toLocaleString()}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}{visibleText && <CopyButton text={visibleText}/>}</div>}
  </div></div>
},(a,b)=>a.message===b.message&&a.active===b.active&&a.botTitle===b.botTitle&&a.parts.length===b.parts.length&&a.parts.every((part,index)=>part===b.parts[index]))
