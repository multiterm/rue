export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: ChatContent
}

export type ChatContent =
  | string
  | ReadonlyArray<TextPart | ImagePart>

export interface TextPart {
  readonly type: 'text'
  readonly text: string
}

export interface ImagePart {
  readonly type: 'image_url'
  readonly image_url: { readonly url: string }
}

export interface ToolDefinition {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: Record<string, unknown>
  }
}

export interface ChatRequest {
  readonly apiKey: string
  readonly model: string
  readonly messages: ReadonlyArray<ChatMessage>
  readonly tools?: ReadonlyArray<ToolDefinition>
  readonly signal?: AbortSignal
  /** Cap on output tokens. Defaults to {@link DEFAULT_MAX_OUTPUT_TOKENS}. */
  readonly maxTokens?: number
}

/** Default output-token cap, shared by every provider adapter. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: string
}

export interface ChatToolResponse {
  readonly content: string
  readonly toolCalls: ReadonlyArray<ToolCall>
  /** True when the response was cut off by the output-token cap. */
  readonly truncated?: boolean
}

export class OpenRouterError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'OpenRouterError'
  }
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://github.com/super-repo/rue',
    'X-Title': 'Rue'
  }
}

export async function chat(req: ChatRequest): Promise<string> {
  if (!req.apiKey) throw new OpenRouterError('OpenRouter API key not configured', 0)

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(req.apiKey),
    body: JSON.stringify({ model: req.model, messages: req.messages }),
    signal: req.signal
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new OpenRouterError(`HTTP ${response.status}: ${body.slice(0, 200)}`, response.status)
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new OpenRouterError('Empty response from model', 0)
  return content
}

export async function chatWithTools(req: ChatRequest): Promise<ChatToolResponse> {
  if (!req.apiKey) throw new OpenRouterError('OpenRouter API key not configured', 0)

  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  }
  if (req.tools && req.tools.length > 0) body.tools = req.tools

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(req.apiKey),
    body: JSON.stringify(body),
    signal: req.signal
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new OpenRouterError(`HTTP ${response.status}: ${errBody.slice(0, 200)}`, response.status)
  }

  const json = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string
      message?: {
        content?: string
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
      }
    }>
  }
  const message = json.choices?.[0]?.message
  if (!message) throw new OpenRouterError('Empty response from model', 0)

  return {
    content: message.content ?? '',
    toolCalls: (message.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments
    })),
    truncated: json.choices?.[0]?.finish_reason === 'length'
  }
}

export async function* chatStream(req: ChatRequest): AsyncGenerator<string, void, void> {
  if (!req.apiKey) throw new OpenRouterError('OpenRouter API key not configured', 0)

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(req.apiKey),
    body: JSON.stringify({ model: req.model, messages: req.messages, stream: true }),
    signal: req.signal
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new OpenRouterError(`HTTP ${response.status}: ${body.slice(0, 200)}`, response.status)
  }
  if (!response.body) throw new OpenRouterError('No response body for stream', 0)

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
        const token = parseSseLine(line)
        if (token !== null) yield token
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function parseSseLine(line: string): string | null {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const json = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>
    }
    return json.choices?.[0]?.delta?.content ?? null
  } catch {
    return null
  }
}
