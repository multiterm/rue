import {createHash} from 'node:crypto'
import {usageEvent,type UsageEvent} from './usage.ts'
import type { Provider,ApiKeyAuth } from '@earendil-works/pi-ai'

export const sharedProviders = ['openai', 'anthropic', 'google', 'openrouter', 'openai-codex'] as const
export type SharedProvider = typeof sharedProviders[number]
export type CredentialMode = 'availability' | 'key'
export type BrokerResult = { granted: boolean; apiKey?: string; accessToken?:string; expiresAt?:number; credentialId?:string }
export type CredentialSource = {
  kind: 'terminal' | 'worker'; origin: string; id: string; token: string; instance: string;
  generation?: number; signal: AbortSignal; current(): boolean;
}

const transientBrokerStatus=(status:number)=>[429,500,502,503,504].includes(status)
async function retryDelay(ms:number,signal:AbortSignal){
 if(signal.aborted)return
 await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true})})
}
/** Retry only credential retrieval, never inference/tool execution. No key cache or auth bypass. */
export async function brokerCredential(source: CredentialSource, provider: string, mode: CredentialMode,
  signal: AbortSignal, fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<BrokerResult | undefined> {
  if (provider==='openai-codex'&&source.kind!=='terminal')return
  if (!source.current() || signal.aborted || source.signal.aborted || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(provider)) return
  let failure='invalid credential-service response'
  try {
    const origin = new URL(source.origin)
    if (origin.protocol !== 'https:' || origin.origin !== source.origin) return
    if (source.kind === 'worker' && (!Number.isSafeInteger(source.generation) || source.generation! <= 0)) return
    const path = source.kind === 'terminal' ? `/terminal-client/connections/${encodeURIComponent(source.id)}` : `/worker-client/${encodeURIComponent(source.id)}`
    const combined = AbortSignal.any([signal, source.signal, AbortSignal.timeout(25000)])
    let response:Response|undefined
    for(let attempt=0;attempt<4;attempt++){
      if(combined.aborted||!source.current())break
      let delay=250*2**attempt
      try{
        response=await fetcher(`${origin.origin}${path}/provider-keys/${provider}`, {
          method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.any([combined,AbortSignal.timeout(5000)]),
          headers:{authorization:`Bearer ${source.token}`,'content-type':'application/json'},
          body:JSON.stringify({instance:source.instance,...(source.kind==='worker'?{generation:source.generation}:{}),...(mode==='availability'?{availability:true}:{})}),
        })
      }catch{failure='credential-service network or timeout failure';response=undefined}
      if(response?.ok)break
      if(response){
        const status=response.status,retryAfter=Number(response.headers.get('retry-after'))
        await response.body?.cancel().catch(()=>{})
        if([400,401,403,404,409].includes(status))return
        failure=`credential-service HTTP ${status}`
        if(!transientBrokerStatus(status))throw Error('unavailable')
        if(Number.isFinite(retryAfter)&&retryAfter>0)delay=Math.max(delay,Math.min(2000,retryAfter*1000))
      }
      response=undefined
      if(attempt<3&&!combined.aborted&&source.current())await retryDelay(delay,combined)
    }
    if(!response?.ok)throw Error('unavailable')
    failure='invalid credential-service response'
    const reader = response.body?.getReader()
    if (!reader) return
    let length = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.byteLength
        if (length > 32768 || combined.aborted || !source.current()) throw Error('invalid')
        chunks.push(part.value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    if (combined.aborted || !source.current()) return
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (data?.provider !== provider) return
    if (mode === 'availability') return { granted: data.granted === true }
    if(provider==='openai-codex'){
      if(Object.keys(data).some(key=>!['provider','credentialType','accessToken','expiresAt'].includes(key))||data.credentialType!=='oauth'||typeof data.accessToken!=='string'||data.accessToken.length>16384||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(data.accessToken)||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=Date.now()+5000)return
      return {granted:true,accessToken:data.accessToken,expiresAt:data.expiresAt}
    }
    if (typeof data.apiKey !== 'string' || !data.apiKey.trim() || data.apiKey.length > 4096 || /[^\x20-\x7e]/.test(data.apiKey)) return
    return { granted: true, apiKey: data.apiKey,...(typeof data.credentialId==='string'&&/^key_[a-f0-9]{64}$/.test(data.credentialId)?{credentialId:data.credentialId}:{}) }
  } catch {
    if (signal.aborted || source.signal.aborted || !source.current()) return
    throw Error(`Rue shared provider key unavailable. ${failure}. Check the Rue API connection and explicit AI-key grant; no model request was replayed.`)
  }
}

/** Literal ModelAuth avoids Pi's !command/$ENV config-value interpreter.
 * Existing local API keys/OAuth win. Availability reads metadata, never plaintext. */
export function providerWithBroker(base: Provider,
  read: (mode: CredentialMode, signal: AbortSignal) => Promise<BrokerResult | undefined>,report?:(event:UsageEvent)=>void): Provider {
  const credentials=new Map<string,string>()
  const fingerprint=(key:string)=>createHash('sha256').update(key).digest('hex')
  const observe=(stream:ReturnType<Provider['streamSimple']>,apiKey?:string)=>{
    const credentialId=apiKey?credentials.get(fingerprint(apiKey))??null:null
    if(report)void stream.result().then(message=>{const event=usageEvent(message,credentialId);if(event)report(event)}).catch(()=>{})
    return stream
  }
  const codex=base.id==='openai-codex'
  const apiKey:ApiKeyAuth|undefined=base.auth.apiKey??(codex?{name:'Rue OAuth access grant',resolve:async()=>undefined}:undefined)
  if (!apiKey) return base
  const auth = { ...base.auth, apiKey: { ...apiKey,
    async check(input: Parameters<NonNullable<typeof apiKey.check>>[0]) {
      const local = apiKey.check ? await apiKey.check(input) : await apiKey.resolve(input)
      if (local) return { type: 'api_key' as const, source: local.source }
      try { if ((await read('availability', input.signal))?.granted) return { type: codex?'oauth' as const:'api_key' as const, source: codex?'Rue OAuth grant':'Rue grant' } } catch { /* unavailable, not configured */ }
      return undefined
    },
    async resolve(input: Parameters<typeof apiKey.resolve>[0]) {
      const local = await apiKey.resolve(input)
      if (local) return local
      const result=await read('key',input.signal)
      if(result?.apiKey&&result.credentialId){if(credentials.size>=32)credentials.clear();credentials.set(fingerprint(result.apiKey),result.credentialId)}
      const key=codex?(result?.expiresAt&&result.expiresAt>Date.now()+5000?result.accessToken:undefined):result?.apiKey
      // Pi's ModelAuth.apiKey is the request bearer slot, NOT a stored API-key
      // credential. No synthetic OAuth store or refresh token exists here.
      return key ? { auth: { apiKey: key }, source: codex?'Rue OAuth grant':'Rue grant' } : undefined
    },
  } }
  const codexOptions=<T,>(options:T|undefined)=>({...options,transport:'sse' as const,maxRetries:0,
    fetch:((url,init)=>((options as {fetch?:typeof fetch}|undefined)?.fetch??globalThis.fetch)(url,{...init,redirect:'error'})) as typeof fetch}) as T&{transport:'sse';maxRetries:number;fetch:typeof fetch}
  // Preserve class-backed/frozen providers and original method receivers.
  return {
    id: base.id, name: base.name, baseUrl: base.baseUrl, headers: base.headers, auth,
    getModels: base.getModels.bind(base), stream:(model,context,options)=>observe(base.stream(model,context,codex?codexOptions(options):options),options?.apiKey), streamSimple:(model,context,options)=>observe(base.streamSimple(model,context,codex?codexOptions(options):options),options?.apiKey),
    refreshModels: base.refreshModels?.bind(base), filterModels: base.filterModels?.bind(base),
    fetchDeferred: base.fetchDeferred?.bind(base), cancelDeferred: base.cancelDeferred?.bind(base),
  }
}
