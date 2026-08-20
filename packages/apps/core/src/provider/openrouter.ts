import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  ProviderError,
  type ChatMessage,
  type ChatRequest,
  type ChatToolResponse,
  type Provider,
  type ToolCall,
} from './types.js'

/**
 * OpenRouter adapter. Speaks the OpenAI /v1/chat/completions wire format.
 *
 * Streaming strategy: when no tools are involved we still issue the
 * non-streaming endpoint (matches old behaviour), but we additionally support
 * a true SSE stream variant for `rue run` where tools are not configured.
 * The session loop calls `chat()` exclusively — the streaming variant is
 * exposed for callers who want raw text deltas without a tool harness.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://github.com/super-repo/rue',
    'X-Title': 'Rue',
  }
}

export const openrouterProvider: Provider = {
  id: 'openrouter',
  async chat(req, onText): Promise<ChatToolResponse> {
    if (!req.apiKey) {
      throw new ProviderError(
        'OpenRouter API key not configured',
        0,
        'openrouter',
      )
    }
    // No native streaming yet; emit the full content as a single delta so
    // the loop's text-delta path still fires.
    const result = await openrouterChatWithTools(req)
    if (result.content) onText(result.content)
    return result
  },
}

export async function openrouterChatWithTools(req: ChatRequest): Promise<ChatToolResponse> {
  if (!req.apiKey) {
    throw new ProviderError('OpenRouter API key not configured', 0, 'openrouter')
  }
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  }
  if (req.tools && req.tools.length > 0) body.tools = req.tools

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(req.apiKey),
    body: JSON.stringify(body),
    signal: req.signal,
  })
  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new ProviderError(
      `HTTP ${response.status}: ${errBody.slice(0, 200)}`,
      response.status,
      'openrouter',
    )
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
  if (!message) {
    throw new ProviderError('Empty response from model', 0, 'openrouter')
  }
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }))
  return {
    content: message.content ?? '',
    toolCalls,
    truncated: json.choices?.[0]?.finish_reason === 'length',
  }
}

/** True SSE token stream — used by callers that don't need tool support. */
export async function* openrouterChatStream(req: ChatRequest): AsyncGenerator<string, void, void> {
  if (!req.apiKey) {
    throw new ProviderError('OpenRouter API key not configured', 0, 'openrouter')
  }
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(req.apiKey),
    body: JSON.stringify({ model: req.model, messages: req.messages, stream: true }),
    signal: req.signal,
  })
  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new ProviderError(
      `HTTP ${response.status}: ${errBody.slice(0, 200)}`,
      response.status,
      'openrouter',
    )
  }
  if (!response.body) {
    throw new ProviderError('No response body for stream', 0, 'openrouter')
  }
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
        const token = parseOpenRouterSseLine(line)
        if (token !== null) yield token
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function parseOpenRouterSseLine(line: string): string | null {
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

// Re-export so callers don't have to know about the chat type.
export type { ChatMessage }
