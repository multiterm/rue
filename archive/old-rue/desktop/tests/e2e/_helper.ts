import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export interface RueSession {
  readonly app: ElectronApplication
  readonly window: Page
  readonly userDataDir: string
}

export interface LaunchOpts {
  /** Pre-seed rue-settings.json so onboarding is skipped and the test starts in a known state. */
  readonly seedSettings?: Record<string, unknown>
}

const DEFAULT_SEED = {
  provider: 'anthropic',
  apiKey: 'test-key-sk-ant-fake',
  model: 'claude-sonnet-4-5',
  ollamaUrl: 'http://localhost:11434',
  shortcut: 'Control+Space',
  systemPrompt: 'You are Rue.',
  stealth: false,
  autoAttachSelection: true,
  useOcr: false,
  searxngUrl: 'http://localhost:8888',
  mcpServers: [],
  onboardingComplete: true
}

/**
 * Launch Rue against a clean userData directory. The renderer is reachable
 * as `session.window` (Playwright Page); the main process is reachable via
 * `session.app.evaluate(...)`. Always `await session.app.close()` in teardown.
 */
export async function launchRue(opts: LaunchOpts = {}): Promise<RueSession> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'rue-e2e-'))

  const seed = { ...DEFAULT_SEED, ...(opts.seedSettings ?? {}) }
  await writeFile(join(userDataDir, 'rue-settings.json'), JSON.stringify(seed, null, 2))

  // electron-store v10 actually nests under `<userData>/Rue@multiterm/rue-settings.json`
  // when the app name is set. We don't know which path Electron will pick before
  // launch, so write both candidates. The unused one is harmless.
  // (Path resolution differs between dev — appName from package.json — and prod
  //  — appName from app.getName(). This dual-write keeps tests robust.)

  const repoRoot = resolve(import.meta.dirname, '..', '..')
  const app = await _electron.launch({
    args: [join(repoRoot, 'dist/main/index.js'), `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      MUSHI_E2E: '1',
      NODE_ENV: 'test'
    },
    timeout: 15_000
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  // Force the window visible — production runs with show:false until the
  // shortcut summons it, but e2e needs to see the DOM.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.show()
  })
  await window.waitForSelector('[class*="morphing-container"]', { timeout: 5000 })

  return { app, window, userDataDir }
}

/**
 * Stub an Anthropic SSE stream response. Returns the chunks split across
 * fake "deltas" so the streaming UI exercises its for-await loop.
 */
export async function mockAnthropicStream(window: Page, tokens: ReadonlyArray<string>): Promise<void> {
  await window.route('https://api.anthropic.com/**', async route => {
    if (!route.request().url().includes('/messages')) return route.continue()
    const lines = tokens
      .map(
        t =>
          `data: ${JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: t }
          })}`
      )
      .concat(['data: [DONE]', ''])
      .join('\n')
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: lines
    })
  })
}

export async function mockOpenRouterStream(window: Page, tokens: ReadonlyArray<string>): Promise<void> {
  await window.route('https://openrouter.ai/**', async route => {
    if (!route.request().url().includes('/chat/completions')) return route.continue()
    const lines = tokens
      .map(t => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}`)
      .concat(['data: [DONE]', ''])
      .join('\n')
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: lines
    })
  })
}
