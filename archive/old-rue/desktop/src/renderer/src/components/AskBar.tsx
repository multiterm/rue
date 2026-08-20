import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button, Input } from '@super-repo/ui'
import {
  BookOpen,
  Camera,
  Edit3,
  Globe,
  History,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  SendHorizonal,
  Settings as SettingsIcon,
  Square,
  X
} from 'lucide-react'
import type { RueSettings, Notebook } from '../../../preload/index.js'
import type { Attachment } from '../lib/attachments.js'
import { SLASH_COMMANDS } from '../lib/slash.js'
import { POP, SNAP } from '../lib/motion.js'
import { AttachmentChip } from './AttachmentChip.js'

interface AskBarProps {
  readonly compact: boolean
  readonly settings: RueSettings
  readonly attachments: ReadonlyArray<Attachment>
  readonly prompt: string
  readonly busy: boolean
  readonly status: string | null
  readonly voiceActive: boolean
  readonly notebooks: ReadonlyArray<Notebook>
  readonly activeNotebook: Notebook | null
  readonly onPromptChange: (v: string) => void
  readonly onAddAttachment: (a: Attachment) => void
  readonly onAttachFiles: (files: FileList | ReadonlyArray<File>) => void
  readonly onRemoveAttachment: (idx: number) => void
  readonly onSend: () => void
  readonly onStop: () => void
  readonly onScreen: () => void
  readonly onSelection: () => void
  readonly onWeb: (url: string) => void
  readonly onVoiceToggle: () => void
  readonly onOpenHistory: () => void
  readonly onOpenSettings: () => void
  readonly onSelectNotebook: (n: Notebook | null) => void
}

export function AskBar(props: AskBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  const [webOpen, setWebOpen] = useState(false)

  // Dismiss the attach menu on any outside click.
  useEffect(() => {
    if (!attachOpen) return
    const onDown = (e: PointerEvent): void => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) setAttachOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [attachOpen])
  const [webUrl, setWebUrl] = useState('')
  // The attachments row needs `overflow-hidden` while its height animates
  // (0 ↔ auto) so chips don't spill out mid-transition. But once settled it
  // must be `overflow-visible`, otherwise it clips the hover-preview popover
  // an AttachmentChip renders above itself. Flip on animation start/complete.
  const [attachmentsSettled, setAttachmentsSettled] = useState(false)

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      props.onSend()
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!item) return
    const file = item.getAsFile()
    if (!file) return
    e.preventDefault()
    const reader = new FileReader()
    reader.onload = () => props.onAddAttachment({ kind: 'screenshot', dataUrl: reader.result as string })
    reader.readAsDataURL(file)
  }

  function submitWeb() {
    if (!webUrl.trim()) return
    props.onWeb(webUrl)
    setWebUrl('')
    setWebOpen(false)
  }

  const showSlashHints = props.prompt.startsWith('/') && !props.prompt.includes(' ')
  const slashFilter = showSlashHints ? props.prompt.slice(1).toLowerCase() : ''
  const allCommands = [
    { name: 'screen', description: 'Take a screenshot and ask about it' },
    { name: 'search', description: 'Web search via SearXNG and synthesize results' },
    ...SLASH_COMMANDS.map(c => ({ name: c.name, description: c.description }))
  ]
  const filteredSlashes = allCommands.filter(c => c.name.startsWith(slashFilter))

  return (
    <div className={`relative ${props.compact ? '' : 'border-t border-border'}`}>
      <div className="px-3 pt-2.5 pb-3.5 flex flex-col gap-1.5">
        {/* ── Row 1: Tool buttons ─────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={e => {
              if (e.target.files && e.target.files.length > 0) props.onAttachFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <div ref={attachMenuRef} className="relative">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setAttachOpen(o => !o)}
              disabled={props.busy}
              title="Add context"
              aria-label="Add context"
              className="size-7 rounded-full border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground [&_svg]:size-4"
            >
              <Plus />
            </Button>
            <AnimatePresence>
              {attachOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.97 }}
                  transition={POP}
                  className="absolute bottom-full left-0 z-20 mb-1.5 w-52 overflow-hidden rounded-lg border border-border bg-popover text-xs text-popover-foreground shadow-xl"
                >
                  <AttachItem
                    icon={<Paperclip className="size-3.5" />}
                    label="Add files or photos"
                    onClick={() => {
                      setAttachOpen(false)
                      fileInputRef.current?.click()
                    }}
                  />
                  <AttachItem
                    icon={<Camera className="size-3.5" />}
                    label="Take a screenshot"
                    onClick={() => {
                      setAttachOpen(false)
                      props.onScreen()
                    }}
                  />
                  <AttachItem
                    icon={<Edit3 className="size-3.5" />}
                    label="Grab selection"
                    onClick={() => {
                      setAttachOpen(false)
                      props.onSelection()
                    }}
                  />
                  <AttachItem
                    icon={<Globe className="size-3.5" />}
                    label="Add a web page"
                    onClick={() => {
                      setAttachOpen(false)
                      setWebOpen(true)
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {props.notebooks.length > 0 && (
            <div className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground">
              <BookOpen className="size-3.5" />
              <select
                value={props.activeNotebook?.id ?? ''}
                onChange={e => {
                  const id = Number(e.target.value)
                  props.onSelectNotebook(id ? props.notebooks.find(n => n.id === id) ?? null : null)
                }}
                className="bg-transparent text-xs outline-none cursor-pointer"
              >
                <option value="">No notebook</option>
                {props.notebooks.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ── Row 1a: inline Web URL entry, only when open ────────────────── */}
        <AnimatePresence>
          {webOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={POP}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 pt-1">
                <Globe className="size-3.5 text-muted-foreground shrink-0" />
                <Input
                  value={webUrl}
                  onChange={e => setWebUrl(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitWeb()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setWebOpen(false)
                      setWebUrl('')
                    }
                  }}
                  placeholder="https://example.com"
                  autoFocus
                  className="h-8 text-xs"
                />
                <Button size="sm" onClick={submitWeb} disabled={!webUrl.trim()} className="h-8 px-3 text-xs">
                  Fetch
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setWebOpen(false)
                    setWebUrl('')
                  }}
                  className="h-8 w-8 text-muted-foreground"
                  title="Cancel"
                >
                  <X />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Row 2: Attachments — only when present, above the input ────── */}
        <AnimatePresence>
          {props.attachments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={POP}
              onAnimationStart={() => setAttachmentsSettled(false)}
              onAnimationComplete={() => setAttachmentsSettled(true)}
              className={`flex flex-wrap gap-1.5 ${attachmentsSettled ? 'overflow-visible' : 'overflow-hidden'}`}
            >
              <AnimatePresence initial={false}>
                {props.attachments.map((a, i) => (
                  <AttachmentChip
                    key={a.uid ?? `att-${i}`}
                    attachment={a}
                    onRemove={() => props.onRemoveAttachment(i)}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Status line ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {props.status && (
            <motion.div
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={SNAP}
              className="text-[11px] text-muted-foreground px-1"
            >
              {props.status}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Slash-command hints — in flow (above the input) so the window
            grows to fit them instead of clipping them off the top edge. ──── */}
        <AnimatePresence>
          {showSlashHints && filteredSlashes.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={POP}
              className="overflow-hidden"
            >
              <div className="overflow-hidden rounded-lg border border-border bg-popover text-xs text-popover-foreground shadow-lg">
                {filteredSlashes.map(c => (
                  <button
                    key={c.name}
                    type="button"
                    className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
                    onClick={() => {
                      props.onPromptChange(`/${c.name} `)
                      textareaRef.current?.focus()
                    }}
                  >
                    <span className="font-mono text-primary">/{c.name}</span>
                    <span className="text-muted-foreground">{c.description}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Row 3: Input row ────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={props.onOpenHistory}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            title="Chats"
          >
            <History />
          </Button>
          <textarea
            ref={textareaRef}
            value={props.prompt}
            onChange={e => props.onPromptChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={props.compact ? 'Ask anything…' : 'Reply…'}
            rows={1}
            autoFocus
            className="askbar-textarea flex-1 px-2 py-1.5"
            style={{ minHeight: 30, maxHeight: 128 }}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={props.settings.holdToRecord ? undefined : props.onVoiceToggle}
            onPointerDown={
              props.settings.holdToRecord
                ? e => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    props.onVoiceToggle()
                  }
                : undefined
            }
            onPointerUp={props.settings.holdToRecord ? () => props.onVoiceToggle() : undefined}
            className={`h-8 w-8 shrink-0 ${props.voiceActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            title={
              props.settings.holdToRecord
                ? 'Hold to record'
                : props.voiceActive
                  ? 'Stop dictation'
                  : 'Dictate'
            }
          >
            {props.voiceActive ? <MicOff /> : <Mic />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={props.onOpenSettings}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            title="Settings (⌘,)"
          >
            <SettingsIcon />
          </Button>
          <motion.div whileTap={{ scale: 0.92 }} whileHover={{ scale: 1.05 }}>
            {props.busy ? (
              <Button
                size="icon"
                onClick={props.onStop}
                className="h-8 w-8 shrink-0 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                title="Stop generating"
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={props.onSend}
                disabled={!props.prompt.trim() && props.attachments.length === 0}
                className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                title="Send (Enter)"
              >
                <SendHorizonal className="size-4" />
              </Button>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  )
}

function AttachItem({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </button>
  )
}
