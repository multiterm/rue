import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  ProviderError,
  type ChatMessage,
  type ChatRequest,
  type ChatToolResponse,
  type Provider,
} from './types.js'

/**
 * Anthropic Messages API adapter.
 *
 * Supports both styles of Anthropic credentials:
 *   - `sk-ant-oat...` Claude Code / Claude Pro OAuth bearer
 *       → Authorization: Bearer ...  +  anthropic-beta: oauth-2025-04-20
 *   - any other token (assumed to be a standard `sk-ant-api03-...` API key)
 *       → x-api-key
 *
 * Streaming uses the native `stream: true` mode so the session loop can emit
 * text-delta bus events as they arrive. Tool-use blocks (Phase 3) are
 * reassembled from `input_json_delta` events.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

function explainStatus(status: number, body: string): string {
  if (status === 401) return 'Authentication failed — your API key or OAuth token is invalid.'
  if (status === 429) return 'Anthropic rate limit hit.'
  if (status === 400) return `Invalid request — Anthropic rejected the payload. ${body.slice(0, 200)}`
  if (status === 403) return 'Forbidden — this token cannot access the selected model.'
  if (status === 529) return 'Anthropic is overloaded — try again in a moment.'
  return `Anthropic API error (HTTP ${status}): ${body.slice(0, 200)}`
}

export function classifyAnthropicToken(token: string): 'oauth' | 'api-key' {
  return token.startsWith('sk-ant-oat') ? 'oauth' : 'api-key'
}

function authHeaders(apiKey: string): Record<string, string> {
  const kind = classifyAnthropicToken(apiKey)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  }
  if (kind === 'oauth') {
    headers.Authorization = `Bearer ${apiKey}`
    headers['anthropic-beta'] = 'oauth-2025-04-20'
  } else {
    headers['x-api-key'] = apiKey
  }
  return headers
}

interface AnthropicContentPart {
  readonly type: 'text' | 'image'
  readonly text?: string
  readonly source?: {
    readonly type: 'base64'
    readonly media_type: string
    readonly data: string
  }
}
interface AnthropicMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string | ReadonlyArray<AnthropicContentPart>
}

function toAnthropicMessages(messages: ReadonlyArray<ChatMessage>): {
  readonly system: string
  readonly messages: ReadonlyArray<AnthropicMessage>
} {
  const systemParts: string[] = []
  const out: AnthropicMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') systemParts.push(m.content)
      continue
    }
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }
    const parts: AnthropicContentPart[] = m.content.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text }
      const dataUrl = p.image_url.url
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) {
        return {
          type: 'text',
          text: '[Unsupported image URL — Anthropic requires base64 data: URLs]',
        }
      }
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: match[1] ?? 'image/png',
          data: match[2] ?? '',
        },
      }
    })
    out.push({ role: m.role, content: parts })
  }
  return { system: systemParts.join('\n\n'), messages: out }
}

export const anthropicProvider: Provider = {
  id: 'anthropic',
  chat(req, onText) {
    return anthropicChatStreamWithTools(req, onText)
  },
}

interface ToolBlockAccumulator {
  readonly id: string
  readonly name: string
  json: string
}

export async function anthropicChatStreamWithTools(
  req: ChatRequest,
  onText: (delta: string) => void,
): Promise<ChatToolResponse> {
  if (!req.apiKey) {
    throw new ProviderError('Anthropic API key not configured', 0, 'anthropic')
  }
  const { system, messages } = toAnthropicMessages(req.messages)
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    system: system || undefined,
    messages,
    stream: true,
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))
  }
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(req.apiKey),
    body: JSON.stringify(body),
    signal: req.signal,
  })
  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new ProviderError(
      explainStatus(response.status, errBody),
      response.status,
      'anthropic',
    )
  }
  if (!response.body) {
    throw new ProviderError('No response body for stream', 0, 'anthropic')
  }
  const textParts: string[] = []
  const toolBlocks = new Map<number, ToolBlockAccumulator>()
  const meta = { stopReason: '' }
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
        handleAnthropicStreamLine(line, textParts, toolBlocks, meta, onText)
      }
    }
  } finally {
    reader.releaseLock()
  }
  const toolCalls = [...toolBlocks.values()].map((b) => ({
    id: b.id,
    name: b.name,
    arguments: b.json || '{}',
  }))
  return {
    content: textParts.join(''),
    toolCalls,
    truncated: meta.stopReason === 'max_tokens',
  }
}

function handleAnthropicStreamLine(
  line: string,
  textParts: string[],
  toolBlocks: Map<number, ToolBlockAccumulator>,
  meta: { stopReason: string },
  onText: (delta: string) => void,
): void {
  if (!line.startsWith('data:')) return
  const payload = line.slice(5).trim()
  if (!payload) return
  let json: {
    type?: string
    index?: number
    content_block?: { type?: string; id?: string; name?: string }
    delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
  }
  try {
    json = JSON.parse(payload)
  } catch {
    return
  }
  if (json.type === 'message_delta' && json.delta?.stop_reason) {
    meta.stopReason = json.delta.stop_reason
    return
  }
  if (json.type === 'content_block_start' && typeof json.index === 'number') {
    const block = json.content_block
    if (block?.type === 'tool_use' && block.id && block.name) {
      toolBlocks.set(json.index, { id: block.id, name: block.name, json: '' })
    }
    return
  }
  if (json.type === 'content_block_delta' && json.delta) {
    if (json.delta.type === 'text_delta' && json.delta.text) {
      textParts.push(json.delta.text)
      onText(json.delta.text)
    } else if (json.delta.type === 'input_json_delta' && typeof json.index === 'number') {
      const block = toolBlocks.get(json.index)
      if (block && json.delta.partial_json) block.json += json.delta.partial_json
    }
  }
}
