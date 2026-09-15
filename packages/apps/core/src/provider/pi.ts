import { Agent } from '@earendil-works/pi-agent-core'
import { createModels, type Message } from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import type { Provider, ChatRequest } from './types.js'

const models = createModels()
models.setProvider(openaiProvider())
export const piModelIds = () => models.getModels('openai').map(model => model.id)

function history(request: ChatRequest): Message[] {
  return request.messages.filter(message => message.role !== 'system').map(message => {
    if (typeof message.content !== 'string') throw new Error('Pi chat currently supports text messages only')
    if (message.role === 'user') return { role: 'user', content: message.content, timestamp: Date.now() }
    return { role: 'assistant', content: [{ type: 'text', text: message.content }], api: 'openai-responses', provider: 'openai', model: request.model,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() }
  })
}

// The Pi agent core is the harness. No coding tools, local resources, ambient
// credentials, extensions, or deployment privileges are loaded into a Rue chat.
export function createPiProvider(runtimeModels = models): Provider { return {
  id: 'openai',
  async chat(request, onText) {
    if (!request.apiKey) throw new Error('Configure an API key in Agent settings')
    const model = runtimeModels.getModel('openai', request.model)
    if (!model) throw new Error('Unsupported OpenAI model')
    const signal = AbortSignal.any([AbortSignal.timeout(120000), ...(request.signal ? [request.signal] : [])])
    const agent = new Agent({
      initialState: { model, tools: [], thinkingLevel: 'off', messages: history(request), systemPrompt: request.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n') },
      streamFn: (model, context, options) => runtimeModels.streamSimple(model, context, { ...options, apiKey: request.apiKey, maxTokens: request.maxTokens ?? 4096, signal }),
      getApiKey: () => request.apiKey,
      shouldStopAfterTurn: () => true,
    })
    const abort = () => agent.abort()
    signal.addEventListener('abort', abort, { once: true })
    const unsubscribe = agent.subscribe(event => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') onText(event.assistantMessageEvent.delta)
    })
    try {
      if (signal.aborted) throw new Error('Agent request cancelled')
      await agent.continue()
      const last = agent.state.messages.at(-1)
      if (last?.role !== 'assistant' || !['stop', 'length'].includes(last.stopReason)) throw new Error('Pi could not complete the reply. Check Agent settings and retry.')
      return { content: last.content.filter(c => c.type === 'text').map(c => c.text).join(''), toolCalls: [], truncated: last.stopReason === 'length' }
    } catch { throw new Error('Pi could not complete the reply. Check Agent settings and retry.') }
    finally { unsubscribe(); signal.removeEventListener('abort', abort); agent.abort(); await agent.waitForIdle() }
  },
} }
export const piProvider = createPiProvider()
