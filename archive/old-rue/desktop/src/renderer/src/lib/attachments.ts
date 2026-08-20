import type { ChatMessage } from './openrouter.js'

export type Attachment =
  | { readonly uid?: string; readonly kind: 'screenshot'; readonly dataUrl: string; readonly ocrText?: string }
  | { readonly uid?: string; readonly kind: 'selection'; readonly text: string }
  | { readonly uid?: string; readonly kind: 'web'; readonly url: string; readonly title: string; readonly text: string }
  | { readonly uid?: string; readonly kind: 'pdf'; readonly name: string; readonly text: string }

let nextUid = 0
export function attachmentUid(): string {
  nextUid += 1
  return `att-${Date.now().toString(36)}-${nextUid}`
}

export function describeAttachment(att: Attachment): string {
  switch (att.kind) {
    case 'screenshot':
      return att.ocrText ? 'Screenshot (OCR)' : 'Screenshot'
    case 'selection': {
      const preview = att.text.slice(0, 24).replace(/\s+/g, ' ')
      return `Selection: "${preview}${att.text.length > 24 ? '…' : ''}"`
    }
    case 'web':
      return att.title.slice(0, 32) || att.url
    case 'pdf':
      return `PDF: ${att.name.slice(0, 28)}`
  }
}

export function buildUserMessage(prompt: string, attachments: ReadonlyArray<Attachment>): ChatMessage {
  if (attachments.length === 0) {
    return { role: 'user', content: prompt }
  }

  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []

  for (const att of attachments) {
    if (att.kind === 'screenshot') {
      if (att.ocrText) {
        parts.push({ type: 'text', text: `[Screen OCR]\n${att.ocrText}` })
      } else {
        parts.push({ type: 'image_url', image_url: { url: att.dataUrl } })
      }
    } else if (att.kind === 'selection') {
      parts.push({ type: 'text', text: `[Selected text]\n${att.text}` })
    } else if (att.kind === 'pdf') {
      parts.push({ type: 'text', text: `[PDF: ${att.name}]\n${att.text}` })
    } else {
      parts.push({ type: 'text', text: `[Web page: ${att.url}]\n${att.text}` })
    }
  }

  parts.push({ type: 'text', text: prompt || 'Use the attached context to help me.' })
  return { role: 'user', content: parts }
}
