import Store from 'electron-store'

export interface McpServerConfig {
  readonly name: string
  readonly command: string
  readonly args?: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
}

export type Provider = 'openrouter' | 'anthropic' | 'ollama'

export type ThemeMode = 'dark' | 'light' | 'glass'

export interface RueSettings {
  readonly provider: Provider
  readonly apiKey: string
  readonly model: string
  readonly ollamaUrl: string
  readonly shortcut: string
  readonly systemPrompt: string
  readonly stealth: boolean
  readonly autoAttachSelection: boolean
  readonly useOcr: boolean
  /** Voice input: press-and-hold the mic to record, vs click to toggle. */
  readonly holdToRecord: boolean
  readonly searxngUrl: string
  readonly mcpServers: ReadonlyArray<McpServerConfig>
  readonly onboardingComplete: boolean
  /** Launch Rue automatically when the user logs in. */
  readonly launchAtLogin: boolean
  /** Show the app icon in the macOS Dock. */
  readonly showInDock: boolean
  /** Show the app's menu-bar / system-tray icon. */
  readonly showInMenuBar: boolean
  readonly theme: ThemeMode
  /** Custom accent color (hex). Overrides the default coral `--primary`. */
  readonly accentColor: string
  /** Local profile — display name shown in the menu-bar menu. */
  readonly profileName: string
  /** Local profile — email shown in the menu-bar menu. */
  readonly profileEmail: string
  /** Developer debugging mode — verbose loop/tool tracing + in-app debug panel. */
  readonly debugMode: boolean
  /** When debug mode is on, let the agent locate and repair the Rue app source. */
  readonly selfHealing: boolean
  /** Absolute path to the Rue app source the self-healing agent may repair. */
  readonly sourceCodePath: string
  /** Absolute path to a reference implementation the agent can consult. */
  readonly referencesPath: string
}

export const DEFAULT_ACCENT = '#ff8d5c'

/**
 * Detect a default API key from the environment so users with Claude Code
 * already authenticated don't have to paste a key. Prefers the OAuth token
 * (longer-lived) over the raw API key.
 */
function defaultKeyFromEnv(): { readonly key: string; readonly provider: Provider } {
  const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? ''
  const anthropic = process.env.ANTHROPIC_API_KEY ?? ''
  const openrouter = process.env.OPENROUTER_API_KEY ?? ''
  if (oauth) return { key: oauth, provider: 'anthropic' }
  if (anthropic) return { key: anthropic, provider: 'anthropic' }
  if (openrouter) return { key: openrouter, provider: 'openrouter' }
  return { key: '', provider: 'anthropic' }
}

const envDefaults = defaultKeyFromEnv()

const DEFAULTS: RueSettings = {
  provider: envDefaults.provider,
  apiKey: envDefaults.key,
  model: envDefaults.provider === 'anthropic' ? 'claude-sonnet-4-5' : 'anthropic/claude-sonnet-4.5',
  ollamaUrl: 'http://localhost:11434',
  shortcut: 'Control+Space',
  systemPrompt:
    'You are Rue, a concise on-screen assistant. The user may attach screenshots, selected text, web page content, or PDFs. Answer directly using the attached context. Keep responses tight unless asked for depth.',
  stealth: false,
  autoAttachSelection: true,
  useOcr: false,
  holdToRecord: false,
  searxngUrl: 'http://localhost:8888',
  mcpServers: [],
  onboardingComplete: false,
  launchAtLogin: false,
  showInDock: true,
  showInMenuBar: true,
  theme: 'dark',
  accentColor: DEFAULT_ACCENT,
  profileName: '',
  profileEmail: '',
  debugMode: false,
  selfHealing: false,
  sourceCodePath: '',
  referencesPath: ''
}

const store = new Store<RueSettings>({ defaults: DEFAULTS, name: 'rue-settings' })

export function getSettings(): RueSettings {
  return {
    provider: store.get('provider'),
    apiKey: store.get('apiKey'),
    model: store.get('model'),
    ollamaUrl: store.get('ollamaUrl'),
    shortcut: store.get('shortcut'),
    systemPrompt: store.get('systemPrompt'),
    stealth: store.get('stealth'),
    autoAttachSelection: store.get('autoAttachSelection'),
    useOcr: store.get('useOcr'),
    holdToRecord: store.get('holdToRecord'),
    searxngUrl: store.get('searxngUrl'),
    mcpServers: store.get('mcpServers'),
    onboardingComplete: store.get('onboardingComplete'),
    launchAtLogin: store.get('launchAtLogin'),
    showInDock: store.get('showInDock'),
    showInMenuBar: store.get('showInMenuBar'),
    theme: store.get('theme'),
    accentColor: store.get('accentColor'),
    profileName: store.get('profileName'),
    profileEmail: store.get('profileEmail'),
    debugMode: store.get('debugMode'),
    selfHealing: store.get('selfHealing'),
    sourceCodePath: store.get('sourceCodePath'),
    referencesPath: store.get('referencesPath')
  }
}

export function setSettings(partial: Partial<RueSettings>): RueSettings {
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) store.set(key as keyof RueSettings, value)
  }
  return getSettings()
}

/**
 * Wipe every persisted setting back to factory defaults. Used by Settings →
 * Data → "Reset to defaults" to recover from a misconfigured state or to
 * start the onboarding flow over. Does NOT touch:
 *   - the conversation history SQLite db (separate file)
 *   - the notebook index db (separate file)
 *   - thumbs up/down ratings (live in history db)
 *
 * The renderer's App.tsx re-renders Welcome automatically once
 * `onboardingComplete` flips back to false.
 */
export function resetSettings(): RueSettings {
  store.clear()
  return getSettings()
}
