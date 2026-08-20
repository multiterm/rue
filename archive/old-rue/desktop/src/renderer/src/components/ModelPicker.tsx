import { useEffect, useRef, useState } from 'react'
import { Input } from '@super-repo/ui'
import { Check, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Provider } from '../../../preload/index.js'
import { POPULAR_MODELS, findModel } from '../lib/models.js'
import { SNAP } from '../lib/motion.js'

interface ModelPickerProps {
  readonly provider: Provider
  readonly value: string
  readonly onChange: (modelId: string, provider: Provider) => void
}

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: 'Anthropic (direct)',
  openrouter: 'OpenRouter',
  ollama: 'Ollama (local)'
}

export function ModelPicker({ provider, value, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [custom, setCustom] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Dismiss the dropdown when the user clicks/taps anything outside it.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCustomMode(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const current = findModel(value)
  const label = current ? current.label : value

  const groups: ReadonlyArray<Provider> = ['anthropic', 'openrouter', 'ollama']

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(o => !o)
          setCustomMode(false)
        }}
        className="flex w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm hover:border-primary/40 transition-colors"
      >
        <div className="flex flex-col items-start gap-0">
          <span className="text-sm">{label}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {PROVIDER_LABELS[current?.provider ?? provider]}
          </span>
        </div>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={SNAP}
            className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-xl max-h-80 overflow-y-auto"
          >
            {groups.map(g => {
              const list = POPULAR_MODELS.filter(m => m.provider === g)
              if (list.length === 0) return null
              return (
                <div key={g}>
                  <div className="section-heading px-3 pt-2 pb-1">{PROVIDER_LABELS[g]}</div>
                  {list.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-accent text-left"
                      onClick={() => {
                        onChange(m.id, m.provider)
                        setOpen(false)
                      }}
                    >
                      <span className="flex flex-col items-start">
                        <span>{m.label}</span>
                        <span className="text-[11px] text-muted-foreground">{m.description}</span>
                      </span>
                      {m.id === value && <Check className="size-4 text-primary" />}
                    </button>
                  ))}
                </div>
              )
            })}
            <div className="border-t border-border">
              {!customMode ? (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-accent"
                  onClick={() => setCustomMode(true)}
                >
                  Custom model slug…
                </button>
              ) : (
                <div className="p-2 space-y-2">
                  <Input
                    value={custom}
                    onChange={e => setCustom(e.target.value)}
                    placeholder="e.g. anthropic/claude-opus-4.7"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && custom.trim()) {
                        onChange(custom.trim(), provider)
                        setOpen(false)
                      }
                    }}
                    autoFocus
                  />
                  <div className="text-[11px] text-muted-foreground">
                    Enter any slug. Will use the currently-selected provider ({PROVIDER_LABELS[provider]}).
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
