import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { agentSettings, saveAgentSettings } from '../../src/storage/agent-settings.js'
import { afterEach, expect, test, vi } from 'vitest'
import { createApp } from '../../src/server/index.js'
import { ConfigSchema } from '../../src/config/index.js'
import { openDatabase } from '../../src/storage/index.js'
import { Bus } from '../../src/bus/index.js'
import { agentApiKey, defaultAgentSettings } from '../../src/storage/agent-settings.js'
import { piProvider } from '../../src/provider/pi.js'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
test('operator key file survives reopening and rejects permissive permissions', () => {
  vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY', '')
  const directory = mkdtempSync(join(tmpdir(), 'rue-agent-vault-')), path = join(directory, 'rue.db')
  let db = openDatabase(path)
  try {
    expect(agentSettings(db, 'alice').keyStorageAvailable).toBe(false)
    writeFileSync(path + '.agent-key', Buffer.alloc(32, 3), { mode: 0o600 })
    saveAgentSettings(db, 'alice', { ...defaultAgentSettings, expectedOwnerSubject: 'alice', expectedRevision: 0, apiKey: 'test-persisted-key' })
    db.close(); db = openDatabase(path)
    expect(agentApiKey(db, 'alice')).toBe('test-persisted-key')
    chmodSync(path + '.agent-key', 0o644)
    expect(agentSettings(db, 'alice').keyStorageAvailable).toBe(false)
    expect(() => agentApiKey(db, 'alice')).toThrow('agent_key_storage_unavailable')
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})
function fixture() {
  const db = openDatabase(':memory:')
  vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => Response.json({ token: { subject: JSON.parse(init.body).token, principalType: 'user' } })))
  const app = createApp({ ctx: { db, bus: new Bus(), config: ConfigSchema.parse({ keyname: { enabled: true, apiUrl: 'https://keyname.test' } }) } })
  const request = (owner: string, path = '/agent/settings', body?: unknown, method = 'PUT') => app.request(path, { method: body === undefined ? 'GET' : method, headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const settings = (extra = {}) => ({ ...defaultAgentSettings, expectedOwnerSubject: 'alice', expectedRevision: 0, ...extra })
  return { db, app, request, settings }
}
test('settings are owner-scoped, write-only for keys, revision checked, and encrypted with owner binding', async () => {
  const { db, app, request, settings } = fixture()
  try {
    expect((await app.request('/agent/settings')).status).toBe(401)
    const saved = await request('alice', '/agent/settings', settings({ apiKey: 'test-alice-key' }))
    expect(saved.status).toBe(200); expect(saved.headers.get('cache-control')).toBe('no-store')
    expect(await saved.text()).not.toContain('test-alice-key')
    expect(await (await request('bob')).json()).toMatchObject({ apiKeyConfigured: false, revision: 0 })
    expect(agentApiKey(db, 'alice')).toBe('test-alice-key')
    const raw = db.prepare('SELECT * FROM agent_settings').all()
    expect(JSON.stringify(raw)).not.toContain('test-alice-key')
    expect((await request('alice', '/agent/settings', settings({ apiKey: 'replacement' }))).status).toBe(409)
    expect((await request('bob', '/agent/settings', settings({ apiKey: 'wrong-owner' }))).status).toBe(409)
    const changed = await request('alice', '/agent/settings', settings({ expectedRevision: 1, systemPrompt: 'Be concise.' }))
    expect(changed.status).toBe(200); expect(agentApiKey(db, 'alice')).toBe('test-alice-key')
    expect((await request('bob', '/agent/settings', settings({ expectedOwnerSubject: 'bob', apiKey: 'test-bob-key' }))).status).toBe(200)
    db.exec("UPDATE agent_settings SET encrypted_key=(SELECT encrypted_key FROM agent_settings WHERE owner_subject='alice') WHERE owner_subject='bob'")
    expect(() => agentApiKey(db, 'bob')).toThrow('agent_key_storage_unavailable')
    expect((await request('alice', '/agent/settings', settings({ expectedRevision: 2, apiKey: null }))).status).toBe(200)
    expect(agentApiKey(db, 'alice')).toBeUndefined()
  } finally { db.close() }
})
test('key writes fail closed without a server encryption key; malformed updates never echo secrets', async () => {
  const { db, request, settings } = fixture()
  try {
    vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY', '')
    const response = await request('alice', '/agent/settings', settings({ apiKey: 'test-secret' }))
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('test-secret')
    expect(db.prepare('SELECT count(*) AS n FROM agent_settings').get()).toEqual({ n: 0 })
    const invalid = await request('alice', '/agent/settings', settings({ provider: 'unknown', apiKey: 'test-secret' }))
    expect(invalid.status).toBe(400); expect(await invalid.text()).not.toContain('test-secret')
  } finally { db.close() }
})
test('chat uses the signed-in owner\'s Pi settings, key, model, and system prompt', async () => {
  const { db, request, settings } = fixture()
  const chat = vi.spyOn(piProvider, 'chat').mockImplementation(async (_req, onText) => { onText('Pi response'); return { content: 'Pi response', toolCalls: [] } })
  try {
    await request('alice', '/agent/settings', settings({ apiKey: 'test-alice-key', systemPrompt: 'Answer concisely.' }))
    const session = await (await request('alice', '/session', { title: 'Pi bot', meta: { description: 'Help with research.' } }, 'POST')).json() as { id: string }
    const response = await request('alice', `/session/${session.id}/message`, { text: 'Hello', wait: true }, 'POST')
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ text: 'Pi response', stopReason: 'completed' })
    expect(chat.mock.calls[0]![0]).toMatchObject({ apiKey: 'test-alice-key', model: defaultAgentSettings.model })
    expect(chat.mock.calls[0]![0].messages[0]).toMatchObject({ role: 'system', content: 'Answer concisely.\n\nHelp with research.' })
    expect((await request('bob', `/session/${session.id}/message`, { text: 'Hello', wait: true }, 'POST')).status).toBe(404)
    expect(chat).toHaveBeenCalledTimes(1)
  } finally { db.close() }
})
