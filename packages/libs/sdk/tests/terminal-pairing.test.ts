import { expect, test, vi } from 'vitest'
import { createRueClient } from '../src/index.js'

test('browser terminal methods retain owner confirmation, refuse approval redirects, and encode identifiers', async () => {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ code: '123456789012', ownerSubject: 'alice', expiresAt: 5000 }))
  const client = createRueClient({ baseUrl: 'https://rue.test', token: async () => 'account-token', fetch })
  await client.approveTerminalPairing('request/id', { expectedOwnerSubject: 'alice', botName: 'Pi' })
  await client.terminalConnections()
  await client.revokeTerminalConnection('connection/id')
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    'https://rue.test/terminal/requests/request%2Fid/approve',
    'https://rue.test/terminal/connections',
    'https://rue.test/terminal/connections/connection%2Fid',
  ])
  const options = fetch.mock.calls[0]![1]!
  expect(options.redirect).toBe('error')
  expect(new Headers(options.headers).get('authorization')).toBe('Bearer account-token')
  expect(JSON.parse(options.body as string)).toEqual({ expectedOwnerSubject: 'alice', botName: 'Pi' })
  expect(fetch.mock.calls[2]![1]!.method).toBe('DELETE')
})
