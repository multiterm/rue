import {registerApplicationBrowserContract} from './app-playwright'
registerApplicationBrowserContract('api')

import { expect, test } from '@playwright/test'
import { APP_CONTRACTS, resolveAppUrl } from './app-contract'
test('deployed API requires authentication and supports browser stream recovery', async ({ request }) => {
  const base = resolveAppUrl(APP_CONTRACTS.find((app) => app.name === 'api')!)
  const health = await request.get(base)
  expect(health.status()).toBe(200)
  expect((await health.json()).ok).toBe(true)
  for (const path of ['/session', '/device', '/sync/preferences']) {
    expect((await request.get(new URL(path, base).href)).status()).toBe(401)
  }
  const preflight = await request.fetch(new URL('/event', base).href, {
    method: 'OPTIONS', headers: { origin: 'https://app.rue.multiterm.dev', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,last-event-id' },
  })
  expect(preflight.status()).toBe(204)
  expect(preflight.headers()['access-control-allow-headers']).toContain('last-event-id')
})
