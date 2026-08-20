import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  type ChatMessage,
  type ChatToolResponse,
  type ToolDefinition
} from './openrouter.js'

export interface AnthropicRequest {
  readonly apiKey: string
  readonly model: string
  readonly messages: ReadonlyArray<ChatMessage>
  readonly tools?: ReadonlyArray<ToolDefinition>
  readonly signal?: AbortSignal
  /** Cap on output tokens. Defaults to {@link DEFAULT_MAX_OUTPUT_TOKENS}. */
  readonly maxTokens?: number
}

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export class AnthropicError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'AnthropicError'
  }
}

/** Translate raw upstream errors into user-friendly chat-surface messages. */
function explainStatus(status: number, body: string): string {
  if (status === 401) {
    return 'Authentication failed — your API key or OAuth token is invalid. Check Settings → Model.'
  }
  if (status === 429) {
    return 'Anthropic rate limit hit. If you\'re using a Claude Pro / Code OAuth token the daily quota may be exhausted — try again later, switch to Haiku (higher limits), or use a standard API key.'
  }
  if (status === 400) {
    return `Invalid request — Anthropic rejected the payload. ${body.slice(0, 200)}`
  }
  if (status === 403) {
    return 'Forbidden — this token cannot access the selected model. Pick a different model or use a different account.'
  }
  if (status === 529) {
    return 'Anthropic is overloaded — try again in a moment.'
  }
  return `Anthropic API error (HTTP ${status}): ${body.slice(0, 200)}`
}

/**
 * Classify an Anthropic credential the same way czar does.
 *
 * - `sk-ant-oat...`  → Claude Code / Claude Pro subscription OAuth bearer.
 *                       Requires `Authorization: Bearer ...` + the
 *                       `anthropic-beta: oauth-2025-04-20` gate.
 * - anything else    → standard API key (sk-ant-api03-...) sent as `x-api-key`.
 *
 * Mismatch here is what caused the 401 "invalid x-api-key" — the earlier
 * implementation checked `sk-ant-oat-` (trailing dash), but real tokens are
 * `sk-ant-oat01-...`, so OAuth bearers were being sent as x-api-key.
 */
export function classifyAnthropicToken(token: string): 'oauth' | 'api-key' {
  return token.startsWith('sk-ant-oat') ? 'oauth' : 'api-key'
}

function authHeaders(apiKey: string): Record<string, string> {
  const kind = classifyAnthropicToken(apiKey)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true'
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
  readonly source?: { readonly type: 'base64'; readonly media_type: string; readonly data: string }
}

interface AnthropicMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string | ReadonlyArray<AnthropicContentPart>
}

/** Convert OpenAI-style chat messages to Anthropic's format. */
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

    const parts: AnthropicContentPart[] = m.content.map(p => {
      if (p.type === 'text') return { type: 'text', text: p.text }
      // image_url with data: URL → base64 source
      const dataUrl = p.image_url.url
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) {
        return { type: 'text', text: '[Unsupported image URL — Anthropic requires base64 data: URLs]' }
      }
      return {
        type: 'image',
        source: { type: 'base64', media_type: match[1] ?? 'image/png', data: match[2] ?? '' }
      }
    })
    out.push({ role: m.role, content: parts })
  }

  return { system: systemParts.join('\n\n'), messages: out }
}

export async function* chatStreamAnthropic(req: AnthropicRequest): AsyncGenerator<string, void, void> {
  if (!req.apiKey) throw new AnthropicError('Anthropic API key not configured', 0)

  const { system, messages } = toAnthropicMessages(req.messages)
  const body = {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    system: system || undefined,
    messages,
    stream: true
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(req.apiKey),
    body: JSON.stringify(body),
    signal: req.signal
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new AnthropicError(explainStatus(response.status, errBody), response.status)
  }
  if (!response.body) throw new AnthropicError('No response body for stream', 0)

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
        const token = parseAnthropicSseLine(line)
        if (token !== null) yield token
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function parseAnthropicSseLine(line: string): string | null {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (!payload) return null
  try {
    const json = JSON.parse(payload) as {
      type?: string
      delta?: { type?: string; text?: string }
    }
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
      return json.delta.text ?? null
    }
    return null
  } catch {
    return null
  }
}

export async function chatWithToolsAnthropic(req: AnthropicRequest): Promise<ChatToolResponse> {
  if (!req.apiKey) throw new AnthropicError('Anthropic API key not configured', 0)

  const { system, messages } = toAnthropicMessages(req.messages)
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    system: system || undefined,
    messages
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }))
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(req.apiKey),
    body: JSON.stringify(body),
    signal: req.signal
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new AnthropicError(explainStatus(response.status, errBody), response.status)
  }

  const json = (await response.json()) as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>
    stop_reason?: string
  }

  const textParts: string[] = []
  const toolCalls: Array<{ id: string; name: string; arguments: string }> = []
  for (const block of json.content ?? []) {
    if (block.type === 'text' && block.text) textParts.push(block.text)
    else if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) })
    }
  }

  return { content: textParts.join('\n'), toolCalls, truncated: json.stop_reason === 'max_tokens' }
}

interface ToolBlockAccumulator {
  readonly id: string
  readonly name: string
  json: string
}

/**
 * Streaming variant of {@link chatWithToolsAnthropic}: text deltas are pushed
 * through `onText` as they arrive (so the UI streams the answer), while
 * tool-use blocks are reassembled from `input_json_delta` events and returned
 * once the message completes.
 */
export async function chatStreamWithToolsAnthropic(
  req: AnthropicRequest,
  onText: (delta: string) => void
): Promise<ChatToolResponse> {
  if (!req.apiKey) throw new AnthropicError('Anthropic API key not configured', 0)

  const { system, messages } = toAnthropicMessages(req.messages)
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    system: system || undefined,
    messages,
    stream: true
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }))
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(req.apiKey),
    body: JSON.stringify(body),
    signal: req.signal
  })
  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new AnthropicError(explainStatus(response.status, errBody), response.status)
  }
  if (!response.body) throw new AnthropicError('No response body for stream', 0)

  const textParts: string[] = []
  // Tool-use blocks accumulate partial input JSON, keyed by content-block index.
  const toolBlocks = new Map<number, ToolBlockAccumulator>()
  // Filled from the terminal `message_delta` event.
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
        handleToolStreamLine(line, textParts, toolBlocks, meta, onText)
      }
    }
  } finally {
    reader.releaseLock()
  }

  const toolCalls = [...toolBlocks.values()].map(block => ({
    id: block.id,
    name: block.name,
    arguments: block.json || '{}'
  }))
  return { content: textParts.join(''), toolCalls, truncated: meta.stopReason === 'max_tokens' }
}

function handleToolStreamLine(
  line: string,
  textParts: string[],
  toolBlocks: Map<number, ToolBlockAccumulator>,
  meta: { stopReason: string },
  onText: (delta: string) => void
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

  // `message_delta` carries the terminal stop_reason (e.g. 'max_tokens').
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
