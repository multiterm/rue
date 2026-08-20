import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  ProviderError,
  type ChatMessage,
  type ChatRequest,
  type ChatToolResponse,
  type Provider,
} from './types.js'

/**
 * Ollama adapter. Talks to a local Ollama instance over `/api/chat`.
 *
 * Ollama supports tools, but the wire format differs from OpenAI's; Phase 2
 * keeps this as text-only (toolCalls always empty) and we'll layer tool
 * support on after the broader tool model lands in Phase 3.
 *
 * Streaming uses Ollama's native JSONL frames. We emit cumulative deltas via
 * `onText` and accumulate the full content for the response payload.
 */

interface OllamaMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
  readonly images?: ReadonlyArray<string>
}

function toOllamaMessages(messages: ReadonlyArray<ChatMessage>): ReadonlyArray<OllamaMessage> {
  return messages.map((m) => {
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
    return {
      role: m.role,
      content: texts.join('\n'),
      images: images.length > 0 ? images : undefined,
    }
  })
}

export const ollamaProvider: Provider = {
  id: 'ollama',
  chat(req, onText) {
    // apiKey is repurposed as the base URL for ollama (consistent with the
    // existing rue convention — settings.ollamaUrl maps to apiKey here).
    const baseUrl = req.apiKey || 'http://localhost:11434'
    return chatOllamaStream({ ...req, apiKey: baseUrl }, onText)
  },
}

export async function chatOllamaStream(
  req: ChatRequest & { apiKey: string },
  onText: (delta: string) => void,
): Promise<ChatToolResponse> {
  const url = `${req.apiKey.replace(/\/$/, '')}/api/chat`
  const body = {
    model: req.model,
    messages: toOllamaMessages(req.messages),
    stream: true,
    options: { num_predict: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS },
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: req.signal,
  })
  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new ProviderError(
      `HTTP ${response.status}: ${errBody.slice(0, 200)}`,
      response.status,
      'ollama',
    )
  }
  if (!response.body) {
    throw new ProviderError('No response body for stream', 0, 'ollama')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const out: string[] = []
  let doneReason = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try {
          const json = JSON.parse(line) as {
            message?: { content?: string }
            done?: boolean
            done_reason?: string
          }
          if (json.done_reason) doneReason = json.done_reason
          if (json.message?.content) {
            out.push(json.message.content)
            onText(json.message.content)
          }
        } catch {
          // ignore malformed frames
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return {
    content: out.join(''),
    toolCalls: [],
    truncated: doneReason === 'length',
  }
}

export interface OllamaTag {
  readonly name: string
  readonly size?: number
}

export async function listOllamaModels(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ReadonlyArray<OllamaTag>> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/tags`
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new ProviderError(`HTTP ${response.status}`, response.status, 'ollama')
  }
  const json = (await response.json()) as {
    models?: Array<{ name: string; size?: number }>
  }
  return (json.models ?? []).map((m) => ({ name: m.name, size: m.size }))
}
