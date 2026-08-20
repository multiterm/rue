import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@super-repo/ui'
import { CircleDot, Square } from 'lucide-react'

interface ShortcutRecorderProps {
  readonly value: string
  readonly onChange: (accelerator: string) => void
}

/**
 * Click "Record", press the desired chord, the new shortcut is captured.
 * Outputs Electron-accelerator format (e.g. "CommandOrControl+Shift+Space").
 */
export function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const stop = useCallback(() => setRecording(false), [])

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      // stopImmediatePropagation also blocks App.tsx's window-level Esc handler
      // (same target — `stopPropagation` alone wouldn't), so pressing Esc to
      // cancel recording doesn't accidentally hide the whole overlay.
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        stop()
        return
      }
      const key = mainKeyFromEvent(e)
      if (!key) return
      const parts: string[] = []
      if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      parts.push(key)
      onChange(parts.join('+'))
      stop()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange, stop])

  return (
    <div ref={ref} className="flex items-center gap-2">
      <div
        className={`flex-1 flex h-9 items-center rounded-md border px-3 text-sm transition-colors ${
          recording ? 'border-primary bg-primary/10' : 'border-input bg-transparent'
        }`}
      >
        {recording ? (
          <span className="text-primary animate-pulse">Press any key combination… (Esc to cancel)</span>
        ) : (
          <span>{value || <span className="text-muted-foreground">No shortcut</span>}</span>
        )}
      </div>
      <Button
        size="sm"
        variant={recording ? 'destructive' : 'outline'}
        onClick={() => setRecording(r => !r)}
        className="shrink-0"
      >
        {recording ? <><Square /> Stop</> : <><CircleDot /> Record</>}
      </Button>
    </div>
  )
}

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Escape',
  Tab: 'Tab',
  Enter: 'Return',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

function mainKeyFromEvent(e: KeyboardEvent): string | null {
  const k = e.key
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(k)) return null
  if (NAMED_KEYS[k]) return NAMED_KEYS[k]
  if (k.length === 1) return k.toUpperCase()
  if (/^F\d{1,2}$/.test(k)) return k
  return null
}
