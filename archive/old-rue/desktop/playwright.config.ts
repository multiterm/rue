import { defineConfig } from '@playwright/test'

/**
 * Electron e2e config.
 *
 * Tests launch the packaged main process directly via `_electron.launch` —
 * there's no webServer, since the renderer is served by Electron from the
 * built `dist/renderer/`. The `pnpm test:e2e` script wires `pnpm build` as a
 * prerequisite so `dist/` always exists before tests run.
 *
 * Each spec gets its own temporary userData dir (see `tests/e2e/_helper.ts`)
 * so the better-sqlite3 history file, electron-store settings, and notebook
 * DB don't leak between tests.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, // each Electron app is heavy; run sequentially
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 30_000,
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
