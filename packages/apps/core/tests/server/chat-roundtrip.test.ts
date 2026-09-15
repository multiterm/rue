import { expect, test, vi } from 'vitest'
import { createApp } from '../../src/server/index.js'
import { Bus } from '../../src/bus/index.js'
import { ConfigSchema } from '../../src/config/index.js'
import { openDatabase } from '../../src/storage/index.js'
import { getAuthBackend } from '../../src/auth/index.js'
import { anthropicProvider } from '../../src/provider/anthropic.js'

test('a newly created bot persists a two-turn conversation using its selected provider', async () => {
  const db = openDatabase(':memory:')
  const backend = getAuthBackend()
  await backend.set('anthropic', 'test-only-provider-credential')
  const chat = vi.spyOn(anthropicProvider, 'chat').mockImplementation(async (_request, onText) => {
    onText('Hello from the test bot')
    return { content: 'Hello from the test bot', toolCalls: [] }
  })
  try {
    const app = createApp({ ctx: { db, config: ConfigSchema.parse({}), bus: new Bus() } })
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const created = await post('/session', { title: 'Chat bot', provider: 'anthropic', model: 'test-model' })
    expect(created.status).toBe(200)
    const { id } = await created.json() as { id: string }
    for (const text of ['Hello bot', 'Continue our chat']) {
      const response = await post(`/session/${id}/message`, { text, wait: true })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ text: 'Hello from the test bot', stopReason: 'completed' })
    }
    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[1]![0]).toMatchObject({ model: 'test-model' })
    expect(chat.mock.calls[1]![0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Hello bot' }),
      expect.objectContaining({ role: 'assistant', content: 'Hello from the test bot' }),
      expect.objectContaining({ role: 'user', content: 'Continue our chat' }),
    ]))
    const messages = await (await app.request(`/session/${id}/messages`)).json() as Array<{ role: string }>
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  } finally {
    chat.mockRestore(); await backend.remove('anthropic'); db.close()
  }
})
