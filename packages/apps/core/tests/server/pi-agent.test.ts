import { expect, test, vi } from 'vitest'
import { createModels, fauxProvider, fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai'
import { createPiProvider } from '../../src/provider/pi.js'

test('Pi agent streams text with explicit credentials, history, prompt, and no tools', async () => {
  const faux = fauxProvider({ provider: 'openai', models: [{ id: 'test-model', reasoning: false }] })
  faux.setResponses([fauxAssistantMessage([fauxText('Pi says hello')])])
  const models = createModels(); models.setProvider(faux.provider)
  const stream = vi.spyOn(models, 'streamSimple')
  const provider = createPiProvider(models), chunks: string[] = []
  const result = await provider.chat({ apiKey: 'test-owner-key', model: 'test-model', messages: [{ role: 'system', content: 'Be helpful.' }, { role: 'user', content: 'Hello' }] }, chunk => chunks.push(chunk))
  expect(result.content).toBe('Pi says hello'); expect(chunks.join('')).toBe('Pi says hello')
  expect(stream.mock.calls[0]![1]).toMatchObject({ systemPrompt: 'Be helpful.', tools: [] })
  expect(stream.mock.calls[0]![2]).toMatchObject({ apiKey: 'test-owner-key' })
  await expect(provider.chat({ apiKey: '', model: 'test-model', messages: [{ role: 'user', content: 'Hello' }] }, () => {})).rejects.toThrow('Configure an API key')
  expect(stream).toHaveBeenCalledTimes(1)
  // The exhausted faux provider emits an error; Pi must not report success.
  await expect(provider.chat({ apiKey: 'test-owner-key', model: 'test-model', messages: [{ role: 'user', content: 'Hello' }] }, () => {})).rejects.toThrow('Pi could not complete')
})
