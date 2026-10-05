import {OPENAI_CODEX_MODELS} from '@earendil-works/pi-ai/providers/openai-codex.models'
import {OPENAI_MODELS} from '@earendil-works/pi-ai/providers/openai.models'
import {ANTHROPIC_MODELS} from '@earendil-works/pi-ai/providers/anthropic.models'
import {GOOGLE_MODELS} from '@earendil-works/pi-ai/providers/google.models'
import {OPENROUTER_MODELS} from '@earendil-works/pi-ai/providers/openrouter.models'
type CatalogProvider='openai'|'anthropic'|'google'|'openrouter'
const registries:Record<CatalogProvider,Record<string,{id:string;name:string;contextWindow:number}>>={openai:OPENAI_MODELS,anthropic:ANTHROPIC_MODELS,google:GOOGLE_MODELS,openrouter:OPENROUTER_MODELS}
const labels={openai:'OpenAI',anthropic:'Anthropic',google:'Google',openrouter:'OpenRouter'}
/** Pinned runtime catalog, not a claim that the caller's account has access. */
export const providerCatalog=Object.entries(registries).map(([id,models])=>({id:id as keyof typeof registries,name:labels[id as keyof typeof labels],models:Object.values(models).filter(model=>model.id.length<=128).map(model=>({id:model.id,name:model.name,contextWindow:model.contextWindow})).sort((a,b)=>a.name.localeCompare(b.name))}))
export const managedProviderCatalog=[...providerCatalog,{id:'openai-codex' as const,name:'OpenAI Codex',models:Object.values(OPENAI_CODEX_MODELS).filter(m=>m.id.length<=128).map(m=>({id:m.id,name:m.name,contextWindow:m.contextWindow}))}]
export const credentialProviders=[...providerCatalog.map(provider=>({id:provider.id,name:provider.name,auth:'api_key' as const})),{id:'openai-codex' as const,name:'OpenAI Codex',auth:'oauth' as const}]
export const supportedProviderModel=(provider:string,model:string)=>providerCatalog.some(p=>p.id===provider&&p.models.some(m=>m.id===model))
