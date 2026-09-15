import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const data = mkdtempSync(join(tmpdir(), 'rue-api-e2e-'))
export default defineConfig({
  testDir: 'tests/e2e', timeout: 30_000, fullyParallel: false,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:5197' },
  metadata: { rueApiE2eData: data }, globalTeardown: './tests/e2e/global-teardown.ts',
  webServer: {
    command: 'pnpm exec rune build && node dist/bin.js serve --hostname 127.0.0.1 --port 5197',
    url: 'http://127.0.0.1:5197/health', reuseExistingServer: false, timeout: 120_000,
    env: { RUE_DATA_DIR: join(data, 'data'), XDG_CONFIG_HOME: join(data, 'config'), KEYNAME_AUTH_ENABLED: 'false' },
  },
})
