import { expect, test, vi } from 'vitest'
import { createModels, fauxProvider, fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai'
import { createPiProvider } from '../../src/provider/pi.js'
import { validateContent, appendContent } from '../../src/storage/attachments.js'
import { openDatabase, createSession, appendMessage } from '../../src/storage/index.js'
import { runQuery } from '../../src/session/index.js'
import { Bus } from '../../src/bus/index.js'
import { estimateTokensForConversation } from '../../src/session/compaction.js'

const image = { type: 'file' as const, name: 'screen.png', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=' }
test('file types are sniffed; active HTML/SVG cannot become preview content', () => {
  expect(validateContent([{ ...image, name: '../bad\nname.svg', data: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') }])?.[0]).toMatchObject({ name: '.._bad_name.svg', mimeType: 'application/octet-stream' })
  expect(validateContent([image])?.[0]).toMatchObject({ mimeType: 'image/png', size: Buffer.from(image.data, 'base64').length })
  for (const data of ['!', 'AAA', 'AAAA===']) expect(() => validateContent([{ ...image, data }])).toThrow()
})
test('persisted ordered attachments reach the cloud Pi harness as image/text, with honest binary limitations', async () => {
  const db = openDatabase(':memory:')
  try {
    createSession(db, { id: 'session' }); appendMessage(db, { id: 'user', sessionId: 'session', role: 'user' })
    appendContent(db, 'session', 'user', validateContent([
      { type: 'text', text: 'Before' }, image, { type: 'text', text: 'After' },
      { type: 'file', name: 'notes.txt', mimeType: 'text/plain', data: Buffer.from('Read this evidence').toString('base64') },
      { type: 'file', name: 'clip.mp4', mimeType: 'video/mp4', data: Buffer.from('video data').toString('base64') },
    ])!)
    appendMessage(db, { id: 'assistant', sessionId: 'session', role: 'assistant' })
    const faux = fauxProvider({ provider: 'openai', models: [{ id: 'test-model', reasoning: false }] })
    faux.setResponses([fauxAssistantMessage([fauxText('Received attachments')])])
    const models = createModels(); models.setProvider(faux.provider)
    const stream = vi.spyOn(models, 'streamSimple')
    const result = await runQuery({ db, bus: new Bus(), sessionId: 'session', messageId: 'assistant', provider: createPiProvider(models), model: 'test-model', apiKey: 'explicit-key' })
    expect(result.text).toBe('Received attachments')
    const content = stream.mock.calls[0]![1].messages[0]!.content
    expect(content).toEqual(expect.arrayContaining([{ type: 'text', text: 'Before' }, { type: 'image', data: image.data, mimeType: 'image/png' }, { type: 'text', text: 'After' }]))
    expect(JSON.stringify(content)).toContain('Read this evidence')
    expect(JSON.stringify(content)).toContain('cannot inspect its contents')
    expect(estimateTokensForConversation([{ role: 'user', content: [{ type: 'text', text: '12345678' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }])).toBe(1026)
  } finally { db.close() }
})
