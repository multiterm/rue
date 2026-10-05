import type { RueMessage, RuePart } from '@multiterm/rue-sdk'
import { ChatMessage } from './chat-message'

export interface SubmittedMessage {
  sessionId: string
  text: string
  attachments: string[]
  time: number
  previousIds: string[]
}

// Keep the local echo outside the query cache so polling cannot erase it.
export function SubmittedMessageEcho({ pending, messages, parts }: { pending: SubmittedMessage; messages: RueMessage[]; parts: RuePart[] }) {
  const delivered = messages.some(message => message.role === 'user' && !pending.previousIds.includes(message.id) && parts.filter(part => part.messageId === message.id && part.type === 'text').sort((a, b) => a.seq - b.seq).map(part => String(part.payload.text ?? '')).join('') === pending.text)
  if (delivered) return null
  const message: RueMessage = { id: 'local-submission', sessionId: pending.sessionId, role: 'user', time: pending.time, provider: null, model: null, agent: null, meta: {}, seq: 0 }
  return <ChatMessage message={message} parts={[{ id: 'local-submission-text', sessionId: pending.sessionId, messageId: message.id, type: 'text', seq: 0, payload: { text: [pending.text, ...pending.attachments.map(name => `[Attachment: ${name}]`)].join('\n'), remoteStatus: 'queued' } }]}/>
}
