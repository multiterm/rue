import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button, Input, ScrollArea, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@super-repo/ui'
import { AlertTriangle, Check, Download, FolderPlus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
import type { RueSettings, McpServerConfig, Notebook, Provider } from '../../../preload/index.js'
import { ModelPicker } from './ModelPicker.js'
import { ShortcutRecorder } from './ShortcutRecorder.js'
import { defaultModelFor } from '../lib/models.js'
import { POP } from '../lib/motion.js'

interface SettingsOverlayProps {
  readonly settings: RueSettings
  readonly notebooks: ReadonlyArray<Notebook>
  readonly onChange: (partial: Partial<RueSettings>) => Promise<void>
  readonly onReset: () => Promise<void>
  readonly onNotebooksChange: () => Promise<void>
  readonly onClose: () => void
}

// Same data-attr override pattern used by the shadcn TabsTrigger
const ACTIVE_TAB =
  'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md text-muted-foreground hover:text-foreground'

/**
 * Sub-prop type used by every section. Sections mutate the local *draft*,
 * not the saved settings — the Save button at the top commits.
 */
interface SectionProps {
  readonly draft: RueSettings
  readonly setDraft: (partial: Partial<RueSettings>) => void
  readonly notebooks?: ReadonlyArray<Notebook>
  readonly onNotebooksChange?: () => Promise<void>
  readonly onReset?: () => Promise<void>
}

export function SettingsOverlay(props: SettingsOverlayProps) {
  const [draft, setDraftState] = useState<RueSettings>(props.settings)
  const [saving, setSaving] = useState(false)

  // Keep draft in sync if the parent's settings reference changes from outside
  // (e.g. another save path). Two-way binding without losing local edits is a
  // pain; here we only re-seed the draft when there are no pending edits.
  useEffect(() => {
    if (!isDirty(draft, props.settings)) {
      setDraftState(props.settings)
    }
    // intentional: depend on saved settings only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.settings])

  const dirty = isDirty(draft, props.settings)

  // Live theme preview: apply the draft's theme + accent while the panel is
  // open so changes are visible before saving. On close (unmount), revert to
  // whatever is saved — so unsaved changes never stick. `savedRef` tracks the
  // latest saved settings so the unmount revert uses the post-save value.
  const savedRef = useRef(props.settings)
  useEffect(() => {
    savedRef.current = props.settings
  }, [props.settings])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = draft.theme
    root.style.setProperty('--primary', draft.accentColor)
  }, [draft.theme, draft.accentColor])

  useEffect(
    () => () => {
      const root = document.documentElement
      root.dataset.theme = savedRef.current.theme
      root.style.setProperty('--primary', savedRef.current.accentColor)
    },
    []
  )

  const setDraft = (partial: Partial<RueSettings>): void => {
    setDraftState(prev => ({ ...prev, ...partial }))
  }

  async function save(): Promise<void> {
    if (!dirty || saving) return
    setSaving(true)
    await props.onChange(diff(props.settings, draft))
    setSaving(false)
  }

  function revert(): void {
    setDraftState(props.settings)
  }

  const section: SectionProps = {
    draft,
    setDraft,
    notebooks: props.notebooks,
    onNotebooksChange: props.onNotebooksChange,
    onReset: props.onReset
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full flex-col"
    >
      <div className="drag flex h-11 items-center justify-between border-b border-border px-3">
        <span className="section-heading" style={{ marginBottom: 0 }}>
          Settings
        </span>
        <div className="no-drag flex items-center gap-1.5">
          <AnimatePresence>
            {dirty && (
              <motion.div
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={POP}
                className="flex items-center gap-1.5"
              >
                <span className="text-[11px] text-muted-foreground">Unsaved changes</span>
                <Button size="sm" variant="ghost" onClick={revert} disabled={saving} className="h-7 px-2 text-xs">
                  Revert
                </Button>
                <Button size="sm" onClick={() => void save()} disabled={saving} className="h-7 px-3 text-xs">
                  <Check className="size-3.5" />
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
          <Button variant="ghost" size="icon" onClick={props.onClose} className="h-7 w-7" title="Close (Esc)">
            <X />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="model" className="flex-1 flex flex-col min-h-0">
        <div className="px-3 pt-2">
          <TabsList className="gap-1 bg-muted/40">
            <TabsTrigger value="model" className={ACTIVE_TAB}>Model</TabsTrigger>
            <TabsTrigger value="preferences" className={ACTIVE_TAB}>Preferences</TabsTrigger>
            <TabsTrigger value="prompt" className={ACTIVE_TAB}>Prompt</TabsTrigger>
            <TabsTrigger value="notebooks" className={ACTIVE_TAB}>Notebooks</TabsTrigger>
            <TabsTrigger value="tools" className={ACTIVE_TAB}>Tools</TabsTrigger>
            <TabsTrigger value="data" className={ACTIVE_TAB}>Data</TabsTrigger>
            <TabsTrigger value="debug" className={ACTIVE_TAB}>Debug</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="flex-1">
          <TabsContent value="model"><ModelTab {...section} /></TabsContent>
          <TabsContent value="preferences"><PreferencesTab {...section} /></TabsContent>
          <TabsContent value="prompt"><PromptTab {...section} /></TabsContent>
          <TabsContent value="notebooks"><NotebooksTab {...section} /></TabsContent>
          <TabsContent value="tools"><ToolsTab {...section} /></TabsContent>
          <TabsContent value="data"><DataTab onReset={props.onReset} /></TabsContent>
          <TabsContent value="debug"><DebugTab {...section} /></TabsContent>
        </ScrollArea>
      </Tabs>
    </motion.div>
  )
}

// Sections only update the draft; the Save button commits.

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
    </label>
  )
}

function ModelTab({ draft, setDraft }: SectionProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Field label="Model" hint="Pick from the list or enter a custom slug.">
        <ModelPicker
          provider={draft.provider}
          value={draft.model}
          onChange={(model, provider) => setDraft({ model, provider })}
        />
      </Field>

      {draft.provider === 'anthropic' && (
        <Field
          label="Anthropic API key"
          hint="Paste an sk-ant-... key OR a Claude Code OAuth token (sk-ant-oat...). $CLAUDE_CODE_OAUTH_TOKEN is read on first launch."
        >
          <Input
            type="password"
            value={draft.apiKey}
            onChange={e => setDraft({ apiKey: e.target.value })}
            placeholder="sk-ant-..."
          />
        </Field>
      )}
      {draft.provider === 'openrouter' && (
        <Field label="OpenRouter API key" hint="openrouter.ai/keys">
          <Input
            type="password"
            value={draft.apiKey}
            onChange={e => setDraft({ apiKey: e.target.value })}
            placeholder="sk-or-..."
          />
        </Field>
      )}
      {draft.provider === 'ollama' && (
        <Field
          label="Ollama URL"
          hint="Local Ollama server. Run `ollama serve` and `ollama pull <model>`."
        >
          <Input
            value={draft.ollamaUrl}
            onChange={e => setDraft({ ollamaUrl: e.target.value })}
            placeholder="http://localhost:11434"
          />
        </Field>
      )}

      <Field label="Provider override" hint="Most users won't need this; the model picker switches providers automatically.">
        <select
          value={draft.provider}
          onChange={e => {
            const provider = e.target.value as Provider
            setDraft({ provider, model: defaultModelFor(provider) })
          }}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
        >
          <option value="anthropic">Anthropic (direct)</option>
          <option value="openrouter">OpenRouter</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </Field>
    </div>
  )
}

const THEMES: ReadonlyArray<{ readonly id: 'dark' | 'light' | 'glass'; readonly label: string }> = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'glass', label: 'Glass' }
]

/** A small uppercase divider that groups related rows within a settings tab. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
      {children}
    </div>
  )
}

function PreferencesTab({ draft, setDraft }: SectionProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <SectionHeading>Appearance</SectionHeading>
      <Field label="Theme" hint="Glass is a translucent dark mode — the desktop shows through.">
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setDraft({ theme: t.id })}
              className={`rounded-md border p-2 text-sm transition-colors ${
                draft.theme === t.id
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Field>

      <SectionHeading>Profile</SectionHeading>
      <div className="flex gap-3">
        <Field label="Profile name" hint="Shown in the menu-bar menu.">
          <Input
            value={draft.profileName}
            onChange={e => setDraft({ profileName: e.target.value })}
            placeholder="Your name"
          />
        </Field>
        <Field label="Profile email" hint="Shown in the menu-bar menu.">
          <Input
            value={draft.profileEmail}
            onChange={e => setDraft({ profileEmail: e.target.value })}
            placeholder="you@example.com"
          />
        </Field>
      </div>

      <SectionHeading>Global shortcut</SectionHeading>
      <Field label="Summon shortcut" hint="Click Record, then press your desired key combination.">
        <ShortcutRecorder value={draft.shortcut} onChange={shortcut => setDraft({ shortcut })} />
      </Field>

      <SectionHeading>Behavior</SectionHeading>
      <ToggleRow
        label="Launch at login"
        hint="Start Rue automatically when you log in."
        checked={draft.launchAtLogin}
        onCheckedChange={v => setDraft({ launchAtLogin: v })}
      />
      <ToggleRow
        label="Show in Dock"
        hint="Display the Rue icon in the macOS Dock."
        checked={draft.showInDock}
        onCheckedChange={v => setDraft({ showInDock: v })}
      />
      <ToggleRow
        label="Show in menu bar"
        hint="Keep the tray icon for quick access and quit."
        checked={draft.showInMenuBar}
        onCheckedChange={v => setDraft({ showInMenuBar: v })}
      />
      <ToggleRow
        label="Stealth mode"
        hint="Hide from screen recordings (setContentProtection)."
        checked={draft.stealth}
        onCheckedChange={v => setDraft({ stealth: v })}
      />
      <ToggleRow
        label="Auto-attach selection on summon"
        hint="Grab the previously-focused window's selection when you summon Rue."
        checked={draft.autoAttachSelection}
        onCheckedChange={v => setDraft({ autoAttachSelection: v })}
      />
      <ToggleRow
        label="OCR fallback for screenshots"
        hint="Use tesseract.js to extract text from screenshots — for non-vision models."
        checked={draft.useOcr}
        onCheckedChange={v => setDraft({ useOcr: v })}
      />
      <ToggleRow
        label="Hold to record"
        hint="Press and hold the mic button to dictate, instead of click-to-toggle."
        checked={draft.holdToRecord}
        onCheckedChange={v => setDraft({ holdToRecord: v })}
      />
    </div>
  )
}

function PromptTab({ draft, setDraft }: SectionProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Field label="System prompt" hint="Prepended to every conversation.">
        <textarea
          rows={6}
          value={draft.systemPrompt}
          onChange={e => setDraft({ systemPrompt: e.target.value })}
          className="flex w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
        />
      </Field>
    </div>
  )
}

function NotebooksTab({ notebooks = [], onNotebooksChange }: SectionProps) {
  const [busyId, setBusyId] = useState<number | null>(null)

  async function createNew() {
    const created = await window.rue.notebook.create()
    if (created && onNotebooksChange) await onNotebooksChange()
  }

  async function reindex(id: number) {
    setBusyId(id)
    await window.rue.notebook.reindex(id)
    setBusyId(null)
    if (onNotebooksChange) await onNotebooksChange()
  }

  async function deleteNb(id: number) {
    await window.rue.notebook.delete(id)
    if (onNotebooksChange) await onNotebooksChange()
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="text-xs text-muted-foreground">
        A notebook is a folder. Rue scans supported files and ranks chunks per query for retrieval.
      </div>
      <Button variant="outline" size="sm" onClick={() => void createNew()} className="self-start">
        <FolderPlus /> Add folder
      </Button>
      <div className="flex flex-col gap-1.5">
        {notebooks.length === 0 ? (
          <div className="text-xs text-muted-foreground">No notebooks yet.</div>
        ) : (
          notebooks.map(n => (
            <div key={n.id} className="flex items-center justify-between rounded-md border border-border p-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{n.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{n.path}</div>
                <div className="text-[11px] text-muted-foreground">{n.fileCount} files indexed</div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => void reindex(n.id)} disabled={busyId === n.id} className="h-7 w-7">
                  <RefreshCw />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => void deleteNb(n.id)} className="h-7 w-7 text-destructive">
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ToolsTab({ draft, setDraft }: SectionProps) {
  const [json, setJson] = useState(() => JSON.stringify(draft.mcpServers ?? [], null, 2))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setJson(JSON.stringify(draft.mcpServers ?? [], null, 2))
  }, [draft.mcpServers])

  function applyJson() {
    setError(null)
    try {
      const parsed = JSON.parse(json) as ReadonlyArray<McpServerConfig>
      if (!Array.isArray(parsed)) throw new Error('Expected an array')
      for (const s of parsed) {
        if (!s.name || !s.command) throw new Error('Each server needs name + command')
      }
      setDraft({ mcpServers: parsed })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Field label="MCP servers" hint="Same JSON shape as Claude Desktop. Spawned as stdio subprocesses; tools exposed to the model.">
        <textarea
          value={json}
          onChange={e => setJson(e.target.value)}
          onBlur={applyJson}
          rows={10}
          spellCheck={false}
          className="font-mono text-xs flex w-full resize-y rounded-md border border-input bg-transparent px-3 py-2"
          placeholder={'[{"name":"fs","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/Users/me"]}]'}
        />
      </Field>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={applyJson}>Validate JSON</Button>
        <Button size="sm" variant="outline" onClick={() => void window.rue.mcp.reconnect()}>Reconnect now</Button>
      </div>
      <Field label="SearXNG URL" hint="Local sidecar for /search.">
        <Input
          value={draft.searxngUrl}
          onChange={e => setDraft({ searxngUrl: e.target.value })}
          placeholder="http://localhost:8888"
        />
      </Field>
    </div>
  )
}

function DataTab({ onReset }: { onReset?: () => Promise<void> }) {
  const [count, setCount] = useState<number | null>(null)
  const [resetting, setResetting] = useState(false)

  async function exportRl() {
    const pairs = await window.rue.history.exportRl()
    const jsonl = pairs.map(p => JSON.stringify(p)).join('\n')
    const blob = new Blob([jsonl], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rue-preferences-${Date.now()}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
    setCount(pairs.length)
  }

  async function reset() {
    if (!onReset) return
    const confirmed = window.confirm(
      'Reset all settings to defaults?\n\n' +
        '• API key, model, provider — cleared\n' +
        '• Shortcut, prompt, MCP config — cleared\n' +
        '• Onboarding will restart\n\n' +
        'Conversation history and notebooks are NOT touched.\n\n' +
        'This cannot be undone.'
    )
    if (!confirmed) return
    setResetting(true)
    await onReset()
    setResetting(false)
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">RL preference export</span>
          <span className="text-[11px] text-muted-foreground/80">
            Thumbs up/down on assistant messages produce preference rows. Export as JSONL for downstream DPO/RLHF training.
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void exportRl()} className="self-start">
          <Download /> Export preferences (JSONL)
        </Button>
        {count !== null && <div className="text-xs text-muted-foreground">Exported {count} preference rows.</div>}
      </div>

      <div className="border-t border-border pt-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">Danger zone</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-foreground">Reset all settings to defaults</span>
          <span className="text-[11px] text-muted-foreground/80">
            Clears your API key, model choice, shortcut, system prompt, and MCP configuration. Starts the onboarding flow over.
            Conversation history and notebooks are preserved.
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reset()}
          disabled={resetting || !onReset}
          className="self-start border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <RotateCcw /> {resetting ? 'Resetting…' : 'Reset to defaults'}
        </Button>
      </div>
    </div>
  )
}

/**
 * A boolean setting rendered as a labelled Switch row — the same card layout
 * the Window tab uses, so toggles look consistent across the settings panel.
 */
function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground/80">{hint}</span>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function DebugTab({ draft, setDraft }: SectionProps) {
  const pickInto =
    (field: 'sourceCodePath' | 'referencesPath') => async (): Promise<void> => {
      const dir = await window.rue.scope.pickFolder()
      if (!dir) return
      setDraft(field === 'sourceCodePath' ? { sourceCodePath: dir } : { referencesPath: dir })
    }

  return (
    <div className="flex flex-col gap-4 p-4">
      <ToggleRow
        label="Debugging mode"
        hint="Verbose loop & tool tracing, plus an in-app debug panel in the chat."
        checked={draft.debugMode}
        // Turning debug mode off also clears self-healing so the saved draft can
        // never hold the inconsistent { debugMode: false, selfHealing: true }.
        onCheckedChange={v => setDraft(v ? { debugMode: true } : { debugMode: false, selfHealing: false })}
      />
      <ToggleRow
        label="Self-healing"
        hint="Let the agent locate and repair problems in the Rue app source. Requires debugging mode."
        checked={draft.selfHealing}
        disabled={!draft.debugMode}
        onCheckedChange={v => setDraft({ selfHealing: v })}
      />

      {draft.debugMode && draft.selfHealing && (
        <>
          <Field label="Source code location" hint="The Rue app folder the agent is allowed to repair.">
            <div className="flex gap-2">
              <Input
                value={draft.sourceCodePath}
                onChange={e => setDraft({ sourceCodePath: e.target.value })}
                placeholder="/path/to/rue/app"
              />
              <Button size="sm" variant="outline" onClick={() => void pickInto('sourceCodePath')()}>
                <FolderPlus /> Choose…
              </Button>
            </div>
          </Field>
          <Field
            label="References location"
            hint="A reference implementation the agent may consult while repairing."
          >
            <div className="flex gap-2">
              <Input
                value={draft.referencesPath}
                onChange={e => setDraft({ referencesPath: e.target.value })}
                placeholder="/path/to/references"
              />
              <Button size="sm" variant="outline" onClick={() => void pickInto('referencesPath')()}>
                <FolderPlus /> Choose…
              </Button>
            </div>
          </Field>
        </>
      )}
    </div>
  )
}

/**
 * Build a partial containing only fields that differ between `from` and `to`.
 * Keeps the IPC payload small and avoids re-triggering side effects (e.g.
 * shortcut re-registration) for unchanged fields.
 */
function diff(from: RueSettings, to: RueSettings): Partial<RueSettings> {
  const out: Partial<Record<keyof RueSettings, unknown>> = {}
  for (const k of Object.keys(to) as Array<keyof RueSettings>) {
    if (!shallowEqual(from[k], to[k])) {
      out[k] = to[k]
    }
  }
  return out as Partial<RueSettings>
}

function isDirty(a: RueSettings, b: RueSettings): boolean {
  for (const k of Object.keys(b) as Array<keyof RueSettings>) {
    if (!shallowEqual(a[k], b[k])) return true
  }
  return false
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]))
  }
  if (a && b && typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}
