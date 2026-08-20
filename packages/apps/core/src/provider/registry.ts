import { anthropicProvider } from './anthropic.js'
import { ollamaProvider } from './ollama.js'
import { openrouterProvider } from './openrouter.js'
import type { Provider } from './types.js'

/**
 * Static provider registry. Maps the `provider` field of session/config to an
 * adapter implementing the {@link Provider} contract.
 *
 * Adding a new provider amounts to writing a new adapter file and adding a
 * record here — no other call sites need to change.
 */
export const PROVIDERS: Readonly<Record<string, Provider>> = {
  openrouter: openrouterProvider,
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
}

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS[id]
}
