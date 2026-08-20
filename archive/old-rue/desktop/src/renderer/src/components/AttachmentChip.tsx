import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, FileText, Globe, Quote, X } from 'lucide-react'
import type { Attachment } from '../lib/attachments.js'
import { POP, SNAP } from '../lib/motion.js'

interface AttachmentChipProps {
  readonly attachment: Attachment
  readonly onRemove: () => void
}

export function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  const [open, setOpen] = useState(false)
  const imageUrl = attachment.kind === 'screenshot' ? attachment.dataUrl : null
  const { icon, label, textPreview } = describe(attachment)
  const expandable = imageUrl !== null || textPreview !== null

  return (
    <span className="relative inline-flex">
      <motion.span
        initial={{ opacity: 0, scale: 0.85, y: -2 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: -2 }}
        transition={POP}
        className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-accent/60 py-0.5 pr-1.5 text-xs text-accent-foreground transition-colors hover:bg-accent ${
          imageUrl ? 'pl-1' : 'pl-2'
        } ${expandable ? 'cursor-default' : ''}`}
        onMouseEnter={() => expandable && setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" className="size-5 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="shrink-0 text-primary/80">{icon}</span>
        )}
        <span className="max-w-[180px] truncate">{label}</span>
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label="Remove attachment"
        >
          <X className="size-3" />
        </button>
      </motion.span>

      <AnimatePresence>
        {open && (imageUrl || textPreview) && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={SNAP}
            className="absolute bottom-full left-0 z-50 mb-1.5 w-80 max-w-[420px] rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-xl"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          >
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {icon} {label}
            </div>
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                className="max-h-56 w-full rounded-md border border-border object-contain"
              />
            ) : (
              <div className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-primary/60 pl-2 leading-relaxed text-foreground/90">
                {textPreview}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  )
}

function describe(a: Attachment): { icon: React.ReactNode; label: string; textPreview: string | null } {
  switch (a.kind) {
    case 'screenshot':
      return {
        icon: <Camera className="size-3" />,
        label: a.ocrText ? 'Image (OCR)' : 'Image',
        textPreview: null
      }
    case 'selection': {
      const oneLine = a.text.replace(/\s+/g, ' ').trim()
      const snippet = oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine
      return {
        icon: <Quote className="size-3" />,
        label: snippet || 'Selected text',
        textPreview: a.text
      }
    }
    case 'web':
      return {
        icon: <Globe className="size-3" />,
        label: a.title.slice(0, 32) || a.url,
        textPreview: `${a.url}\n\n${a.text.slice(0, 800)}${a.text.length > 800 ? '…' : ''}`
      }
    case 'pdf':
      return {
        icon: <FileText className="size-3" />,
        label: `PDF: ${a.name.slice(0, 28)}`,
        textPreview: a.text.slice(0, 800) + (a.text.length > 800 ? '…' : '')
      }
  }
}
