import { describe, it, expect } from 'vitest'
import { describeAttachment, buildUserMessage, type Attachment } from '../../../src/renderer/src/lib/attachments.js'

describe('describeAttachment', () => {
  it('describes a screenshot without OCR', () => {
    expect(describeAttachment({ kind: 'screenshot', dataUrl: 'data:image/png;base64,abc' })).toBe('Screenshot')
  })

  it('describes a screenshot with OCR', () => {
    expect(describeAttachment({ kind: 'screenshot', dataUrl: 'data:image/png;base64,abc', ocrText: 'hi' })).toBe(
      'Screenshot (OCR)'
    )
  })

  it('describes a short selection with the full text quoted', () => {
    const out = describeAttachment({ kind: 'selection', text: 'hello world' })
    expect(out).toBe('Selection: "hello world"')
  })

  it('truncates selections longer than 24 chars with an ellipsis', () => {
    const text = 'a'.repeat(40)
    const out = describeAttachment({ kind: 'selection', text })
    expect(out).toBe(`Selection: "${'a'.repeat(24)}…"`)
  })

  it('collapses whitespace in selection previews', () => {
    const out = describeAttachment({ kind: 'selection', text: 'hello\n\tworld' })
    expect(out).toBe('Selection: "hello world"')
  })

  it('uses the title for a web attachment when present', () => {
    expect(describeAttachment({ kind: 'web', url: 'https://x.com', title: 'X Home', text: '' })).toBe('X Home')
  })

  it('truncates very long web titles to 32 chars', () => {
    const title = 'b'.repeat(60)
    expect(describeAttachment({ kind: 'web', url: 'https://x.com', title, text: '' })).toBe('b'.repeat(32))
  })

  it('falls back to the URL when title is empty', () => {
    expect(describeAttachment({ kind: 'web', url: 'https://example.com', title: '', text: 'body' })).toBe(
      'https://example.com'
    )
  })

  it('describes a PDF attachment with truncated name', () => {
    expect(describeAttachment({ kind: 'pdf', name: 'document.pdf', text: 'body' })).toBe('PDF: document.pdf')
  })
})

describe('buildUserMessage', () => {
  it('returns a plain string message when there are no attachments', () => {
    const msg = buildUserMessage('what time is it?', [])
    expect(msg).toEqual({ role: 'user', content: 'what time is it?' })
  })

  it('emits image_url for plain screenshots', () => {
    const screenshot: Attachment = { kind: 'screenshot', dataUrl: 'data:image/png;base64,xx' }
    const msg = buildUserMessage('describe', [screenshot])
    const parts = msg.content as ReadonlyArray<{ type: string }>
    expect(parts[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } })
  })

  it('substitutes OCR text in place of image_url when ocrText is present', () => {
    const screenshot: Attachment = { kind: 'screenshot', dataUrl: 'data:image/png;base64,xx', ocrText: 'hello on screen' }
    const msg = buildUserMessage('what', [screenshot])
    const parts = msg.content as ReadonlyArray<{ type: string; text?: string }>
    expect(parts[0].type).toBe('text')
    expect(parts[0].text).toContain('Screen OCR')
    expect(parts[0].text).toContain('hello on screen')
  })

  it('serializes selection attachments as a labeled text part', () => {
    const sel: Attachment = { kind: 'selection', text: 'highlighted text' }
    const msg = buildUserMessage('translate', [sel])
    const parts = msg.content as ReadonlyArray<{ type: string; text?: string }>
    expect(parts[0]).toEqual({ type: 'text', text: '[Selected text]\nhighlighted text' })
    expect(parts[1]).toEqual({ type: 'text', text: 'translate' })
  })

  it('serializes web attachments with the URL in the label', () => {
    const web: Attachment = { kind: 'web', url: 'https://example.com', title: 'Example', text: 'body' }
    const msg = buildUserMessage('what does this say', [web])
    const parts = msg.content as ReadonlyArray<{ type: string; text?: string }>
    expect(parts[0]).toEqual({ type: 'text', text: '[Web page: https://example.com]\nbody' })
  })

  it('serializes PDF attachments with name in the label', () => {
    const pdf: Attachment = { kind: 'pdf', name: 'spec.pdf', text: 'body' }
    const msg = buildUserMessage('summarize', [pdf])
    const parts = msg.content as ReadonlyArray<{ type: string; text?: string }>
    expect(parts[0]).toEqual({ type: 'text', text: '[PDF: spec.pdf]\nbody' })
  })

  it('uses a fallback prompt when the user prompt is empty but attachments exist', () => {
    const sel: Attachment = { kind: 'selection', text: 'foo' }
    const msg = buildUserMessage('', [sel])
    const parts = msg.content as ReadonlyArray<{ type: string; text?: string }>
    const last = parts[parts.length - 1]
    expect(last.text).toBe('Use the attached context to help me.')
  })

  it('orders attachments before the prompt text', () => {
    const screenshot: Attachment = { kind: 'screenshot', dataUrl: 'data:image/png;base64,a' }
    const sel: Attachment = { kind: 'selection', text: 'foo' }
    const msg = buildUserMessage('ok', [screenshot, sel])
    const parts = msg.content as ReadonlyArray<{ type: string }>
    expect(parts.map(p => p.type)).toEqual(['image_url', 'text', 'text'])
  })
})
