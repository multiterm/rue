import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button, Input } from '@super-repo/ui'
import { ArrowRight } from 'lucide-react'
import type { RueSettings } from '../../../preload/index.js'
import { ModelPicker } from './ModelPicker.js'
import { defaultModelFor } from '../lib/models.js'
import { INLINE, SHELL } from '../lib/motion.js'
import rueMark from '../../../../resources@multiterm/rue-mark.svg'
import rueBg from '../../../../resources@multiterm/rue-bg.svg'

interface WelcomeProps {
  readonly settings: RueSettings
  readonly onChange: (partial: Partial<RueSettings>) => Promise<void>
  readonly onComplete: () => void
}

type Step = 'intro' | 'key' | 'model' | 'done'

export function Welcome({ settings, onChange, onComplete }: WelcomeProps) {
  const [step, setStep] = useState<Step>('intro')

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={SHELL}
      className="drag-surface relative flex flex-1 flex-col items-center justify-center px-6 py-8 gap-6 text-center overflow-hidden"
    >
      {/* Decorative treasure-map backdrop. */}
      <motion.img
        src={rueBg}
        alt=""
        aria-hidden="true"
        initial={{ opacity: 0, scale: 1.05 }}
        animate={{ opacity: 0.08, scale: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
        className="pointer-events-none absolute inset-0 m-auto h-[120%] w-auto object-contain select-none"
        draggable={false}
      />
      <AnimatePresence mode="wait">
      {step === 'intro' && (
        <motion.div
          key="intro"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={INLINE}
          className="relative z-10 flex flex-col items-center gap-6 w-full"
        >
          <RueLogo className="size-28" />
          <div>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm">
              Your AI assistant for the desktop — a dedicated window for chatting with context from
              screenshots, selected text, and web pages. Summon it anytime with{' '}
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">⌃ Space</kbd>.
            </p>
          </div>
          <Button onClick={() => setStep('key')}>
            Get started <ArrowRight />
          </Button>
        </motion.div>
      )}

      {step === 'key' && (
        <motion.div
          key="key"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={INLINE}
          className="relative z-10 flex flex-col items-center gap-6 w-full"
        >
          <div className="w-full max-w-sm space-y-4 text-left">
            <div>
              <h2 className="text-xl font-semibold">Choose a provider</h2>
              <p className="mt-1 text-xs text-muted-foreground">Rue will use this for chat. You can change it later.</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <ProviderCard
                active={settings.provider === 'anthropic'}
                title="Anthropic"
                subtitle="OAuth or API key"
                onClick={() => void onChange({ provider: 'anthropic', model: defaultModelFor('anthropic') })}
              />
              <ProviderCard
                active={settings.provider === 'openrouter'}
                title="OpenRouter"
                subtitle="One key, many models"
                onClick={() => void onChange({ provider: 'openrouter', model: defaultModelFor('openrouter') })}
              />
              <ProviderCard
                active={settings.provider === 'ollama'}
                title="Ollama"
                subtitle="Local, offline"
                onClick={() => void onChange({ provider: 'ollama', model: defaultModelFor('ollama') })}
              />
            </div>

            {settings.provider === 'anthropic' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Anthropic API key</span>
                <Input
                  type="password"
                  value={settings.apiKey}
                  onChange={e => void onChange({ apiKey: e.target.value })}
                  placeholder="sk-ant-... or sk-ant-oat-..."
                  autoFocus
                />
                <span className="text-[11px] text-muted-foreground">
                  Claude Code OAuth tokens (sk-ant-oat-…) work too. $CLAUDE_CODE_OAUTH_TOKEN was pre-filled if set.
                </span>
              </div>
            )}
            {settings.provider === 'openrouter' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">OpenRouter API key</span>
                <Input
                  type="password"
                  value={settings.apiKey}
                  onChange={e => void onChange({ apiKey: e.target.value })}
                  placeholder="sk-or-..."
                  autoFocus
                />
                <span className="text-[11px] text-muted-foreground">Get one at openrouter.ai/keys</span>
              </div>
            )}
            {settings.provider === 'ollama' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Ollama URL</span>
                <Input
                  value={settings.ollamaUrl}
                  onChange={e => void onChange({ ollamaUrl: e.target.value })}
                  placeholder="http://localhost:11434"
                  autoFocus
                />
                <span className="text-[11px] text-muted-foreground">No key needed. Run `ollama serve` locally.</span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep('intro')}>Back</Button>
            <Button
              onClick={() => setStep('model')}
              disabled={settings.provider !== 'ollama' && !settings.apiKey}
            >
              Continue <ArrowRight />
            </Button>
          </div>
        </motion.div>
      )}

      {step === 'model' && (
        <motion.div
          key="model"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={INLINE}
          className="relative z-10 flex flex-col items-center gap-6 w-full"
        >
          <div className="w-full max-w-sm space-y-4 text-left">
            <div>
              <h2 className="text-xl font-semibold">Pick a model</h2>
              <p className="mt-1 text-xs text-muted-foreground">Pick a default. Switch anytime in Settings.</p>
            </div>
            <ModelPicker
              provider={settings.provider}
              value={settings.model}
              onChange={(model, provider) => void onChange({ model, provider })}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep('key')}>Back</Button>
            <Button onClick={() => setStep('done')}>Continue <ArrowRight /></Button>
          </div>
        </motion.div>
      )}

      {step === 'done' && (
        <motion.div
          key="done"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={INLINE}
          className="relative z-10 flex flex-col items-center gap-6 w-full"
        >
          <RueLogo className="size-20" />
          <div className="max-w-sm">
            <h2 className="text-xl font-semibold">You're set</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Press <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">{settings.shortcut}</kbd> from any app to summon Rue.
              Press <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">Esc</kbd> to hide.
            </p>
          </div>
          <Button
            onClick={async () => {
              // Persist `onboardingComplete: true` BEFORE leaving welcome
              // mode — otherwise App.tsx's welcome-detector effect sees stale
              // settings, immediately bounces us back into the welcome flow,
              // and the user sees a single-frame flicker on the way to bar.
              await onChange({ onboardingComplete: true })
              onComplete()
            }}
          >
            Open Rue <ArrowRight />
          </Button>
        </motion.div>
      )}
      </AnimatePresence>
    </motion.div>
  )
}

/**
 * Brand mark presented as a macOS-style app icon: the black avatar on a
 * white, slightly-rounded-square tile. The tile background stays white
 * regardless of theme so the black potrace silhouette is always legible.
 */
function RueLogo({ className }: { className?: string }) {
  return (
    <motion.div
      role="img"
      aria-label="Rue"
      initial={{ scale: 0.85, opacity: 0, y: 4 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={SHELL}
      className={`flex items-center justify-center rounded-[22%] bg-white shadow-xl ring-1 ring-black/10 select-none ${className ?? ''}`}
    >
      <img src={rueMark} alt="" draggable={false} className="h-[78%] w-[78%] object-contain" />
    </motion.div>
  )
}

function ProviderCard({
  active,
  title,
  subtitle,
  onClick
}: {
  active: boolean
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start rounded-md border p-3 text-left transition-colors ${
        active ? 'border-primary bg-accent' : 'border-border hover:border-primary/40'
      }`}
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-[11px] text-muted-foreground">{subtitle}</span>
    </button>
  )
}
