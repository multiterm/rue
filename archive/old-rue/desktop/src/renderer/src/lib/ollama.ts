import { DEFAULT_MAX_OUTPUT_TOKENS, type ChatMessage, type ChatToolResponse } from './openrouter.js'

export interface OllamaRequest {
  readonly baseUrl: string
  readonly model: string
  readonly messages: ReadonlyArray<ChatMessage>
  readonly signal?: AbortSignal
  /** Cap on output tokens. Defaults to {@link DEFAULT_MAX_OUTPUT_TOKENS}. */
  readonly maxTokens?: number
}

export class OllamaError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'OllamaError'
  }
}

interface OllamaMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
  readonly images?: ReadonlyArray<string>
}

function toOllamaMessages(messages: ReadonlyArray<ChatMessage>): ReadonlyArray<OllamaMessage> {
  return messages.map(m => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content }
    const texts: string[] = []
    const images: string[] = []
    for (const p of m.content) {
      if (p.type === 'text') texts.push(p.text)
      else {
        const match = p.image_url.url.match(/^data:[^;]+;base64,(.+)$/)
        if (match) images.push(match[1] ?? '')
      }
    }
    return { role: m.role, content: texts.join('\n'), images: images.length > 0 ? images : undefined }
  })
}

export async function* chatStreamOllama(req: OllamaRequest): AsyncGenerator<string, void, void> {
  const url = `${req.baseUrl.replace(/\/$/, '')}/api/chat`
  const body = {
    model: req.model,
    messages: toOllamaMessages(req.messages),
    stream: true
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: req.signal
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new OllamaError(`HTTP ${response.status}: ${errBody.slice(0, 200)}`, response.status)
  }
  if (!response.body) throw new OllamaError('No response body for stream', 0)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        const token = parseOllamaLine(line)
        if (token !== null) yield token
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function parseOllamaLine(line: string): string | null {
  if (!line) return null
  try {
    const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
    if (json.done) return null
    return json.message?.content ?? null
  } catch {
    return null
  }
}

export async function chatOllama(req: OllamaRequest): Promise<ChatToolResponse> {
  const url = `${req.baseUrl.replace(/\/$/, '')}/api/chat`
  const body = {
    model: req.model,
    messages: toOllamaMessages(req.messages),
    stream: false,
    options: { num_predict: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: req.signal
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new OllamaError(`HTTP ${response.status}: ${errBody.slice(0, 200)}`, response.status)
  }

  const json = (await response.json()) as { message?: { content?: string }; done_reason?: string }
  return {
    content: json.message?.content ?? '',
    toolCalls: [],
    truncated: json.done_reason === 'length'
  }
}

export interface OllamaTag {
  readonly name: string
  readonly size?: number
}

export async function listOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<ReadonlyArray<OllamaTag>> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/tags`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new OllamaError(`HTTP ${response.status}`, response.status)
  const json = (await response.json()) as { models?: Array<{ name: string; size?: number }> }
  return (json.models ?? []).map(m => ({ name: m.name, size: m.size }))
}
