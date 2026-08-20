import type { Provider } from '../../../preload/index.js'

export interface ModelOption {
  readonly id: string
  readonly label: string
  readonly provider: Provider
  readonly vision: boolean
  readonly description: string
}

export const POPULAR_MODELS: ReadonlyArray<ModelOption> = [
  // ── Anthropic direct ───────────────────────────────────────────────
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', vision: true, description: 'Most capable. 1M context.' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'anthropic', vision: true, description: 'Balanced. Fast.' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', vision: true, description: 'Fastest. Cheapest.' },

  // ── OpenRouter — Anthropic ─────────────────────────────────────────
  { id: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7', provider: 'openrouter', vision: true, description: 'Anthropic via OpenRouter.' },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', provider: 'openrouter', vision: true, description: 'Anthropic via OpenRouter.' },

  // ── OpenRouter — OpenAI ────────────────────────────────────────────
  { id: 'openai/gpt-5', label: 'GPT-5', provider: 'openrouter', vision: true, description: 'OpenAI flagship.' },
  { id: 'openai/o3', label: 'o3', provider: 'openrouter', vision: false, description: 'OpenAI advanced reasoning.' },
  { id: 'openai/o4-mini', label: 'o4-mini', provider: 'openrouter', vision: false, description: 'Fast reasoning.' },
  { id: 'openai/gpt-4.1', label: 'GPT-4.1', provider: 'openrouter', vision: true, description: 'GPT-4 family.' },
  { id: 'openai/gpt-4o', label: 'GPT-4o', provider: 'openrouter', vision: true, description: 'OpenAI multimodal.' },

  // ── OpenRouter — Google ────────────────────────────────────────────
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'openrouter', vision: true, description: 'Google flagship.' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'openrouter', vision: true, description: 'Fast multimodal.' },
  { id: 'google/gemini-2.0-flash-thinking-exp', label: 'Gemini 2.0 Flash Thinking', provider: 'openrouter', vision: true, description: 'Reasoning preview.' },

  // ── OpenRouter — xAI ──────────────────────────────────────────────
  { id: 'x-ai/grok-3', label: 'Grok 3', provider: 'openrouter', vision: true, description: 'xAI flagship.' },
  { id: 'x-ai/grok-2-vision-1212', label: 'Grok 2 Vision', provider: 'openrouter', vision: true, description: 'xAI multimodal.' },

  // ── OpenRouter — Meta ──────────────────────────────────────────────
  { id: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout', provider: 'openrouter', vision: true, description: 'Meta open-source multimodal.' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', provider: 'openrouter', vision: false, description: 'Meta open-source.' },

  // ── OpenRouter — Mistral ───────────────────────────────────────────
  { id: 'mistralai/mistral-large-2411', label: 'Mistral Large', provider: 'openrouter', vision: false, description: 'Mistral flagship.' },
  { id: 'mistralai/codestral-2501', label: 'Codestral', provider: 'openrouter', vision: false, description: 'Coding specialist.' },

  // ── OpenRouter — DeepSeek ──────────────────────────────────────────
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', provider: 'openrouter', vision: false, description: 'Open-source reasoning.' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3', provider: 'openrouter', vision: false, description: 'Open-source general.' },

  // ── OpenRouter — Qwen / Cohere ────────────────────────────────────
  { id: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B', provider: 'openrouter', vision: false, description: 'Alibaba open-source.' },
  { id: 'qwen/qwq-32b-preview', label: 'QwQ 32B', provider: 'openrouter', vision: false, description: 'Qwen reasoning.' },
  { id: 'cohere/command-r-plus', label: 'Command R+', provider: 'openrouter', vision: false, description: 'Cohere RAG-optimized.' },

  // ── Ollama (local) ─────────────────────────────────────────────────
  { id: 'qwen2.5:14b', label: 'Qwen 2.5 14B', provider: 'ollama', vision: false, description: 'Local. Run via ollama pull qwen2.5:14b.' },
  { id: 'llama3.3:70b', label: 'Llama 3.3 70B', provider: 'ollama', vision: false, description: 'Local. Needs ≥48GB RAM.' },
  { id: 'gemma3:12b', label: 'Gemma 3 12B', provider: 'ollama', vision: true, description: 'Local multimodal.' },
  { id: 'deepseek-r1:14b', label: 'DeepSeek R1 14B', provider: 'ollama', vision: false, description: 'Local reasoning.' },
  { id: 'mistral:7b', label: 'Mistral 7B', provider: 'ollama', vision: false, description: 'Local general.' },
  { id: 'phi3.5', label: 'Phi 3.5', provider: 'ollama', vision: false, description: 'Microsoft small.' },
  { id: 'llava:13b', label: 'LLaVA 13B', provider: 'ollama', vision: true, description: 'Local vision model.' }
]

export function findModel(id: string): ModelOption | undefined {
  return POPULAR_MODELS.find(m => m.id === id)
}

export function modelsForProvider(provider: Provider): ReadonlyArray<ModelOption> {
  return POPULAR_MODELS.filter(m => m.provider === provider)
}

export function defaultModelFor(provider: Provider): string {
  const first = modelsForProvider(provider)[0]
  return first?.id ?? 'claude-sonnet-4-5'
}
