export const RUE_SDK_VERSION = '0.2.0-b.0'

export interface RueClientOptions { baseUrl:string; token?:string|(()=>string|undefined|Promise<string|undefined>); fetch?:typeof globalThis.fetch }
export interface RueHealth { ok:boolean; version:string }
export interface RueSession { id:string; title:string; agent:string|null; provider:string|null; model:string|null; directory:string|null; scopes:string[]; parentId:string|null; ownerSubject:string; createdAt:number; updatedAt:number; meta:Record<string,unknown> }
export interface RueMessage { id:string; sessionId:string; role:'user'|'assistant'|'system'; time:number; provider:string|null; model:string|null; agent:string|null; meta:Record<string,unknown>; seq:number }
export interface RuePart { id:string; sessionId:string; messageId:string; type:string; seq:number; payload:Record<string,unknown> }
export interface CreateSessionInput { title?:string; agent?:string; provider?:string; model?:string; directory?:string; scopes?:string[]; parentId?:string; meta?:Record<string,unknown> }
export interface UpdateSessionInput extends CreateSessionInput {}
export interface SendMessageInput { text:string; provider?:string; model?:string; systemPrompt?:string; wait?:boolean }
export interface SendMessageResult { userMessageId:string; assistantMessageId:string; text?:string; stopReason?:string }
export interface RueEvent<T=Record<string,unknown>> { id:number; type:string; time:number; payload:T }
export type RueDevicePlatform='web'|'desktop'|'ios'|'android'|'terminal'
export interface RueDevice {id:string;ownerSubject:string;name:string;platform:RueDevicePlatform;createdAt:number;lastSeenAt:number;revokedAt:number|null}
export interface RuePairing {id:string;token:string;code:string;expiresAt:number}
export interface RuePairingStatus {id:string;expiresAt:number;claimedAt:number|null;claimedDeviceId:string|null}
export interface RuePreference {key:string;value:unknown;version:number;updatedAt:number;updatedByDevice:string|null}
export interface RueDeviceInput {deviceId:string;name:string;platform:RueDevicePlatform}

export function createRueClient(options:RueClientOptions){
  const requestFetch=options.fetch??globalThis.fetch
  const baseUrl=options.baseUrl.replace(/\/$/,'')
  const request=async<T>(path:string,init:RequestInit={}):Promise<T>=>{const supplied=typeof options.token==='function'?await options.token():options.token;const headers=new Headers(init.headers);headers.set('accept','application/json');if(init.body)headers.set('content-type','application/json');if(supplied)headers.set('authorization',`Bearer ${supplied}`);const response=await requestFetch(`${baseUrl}${path}`,{...init,headers});if(!response.ok)throw new RueApiError(response.status,await response.text());return response.json() as Promise<T>}
  return {
    health:()=>request<RueHealth>('/health'),
    sessions:()=>request<RueSession[]>('/session'),
    session:(id:string)=>request<RueSession>(`/session/${encodeURIComponent(id)}`),
    createSession:(input:CreateSessionInput={})=>request<RueSession>('/session',{method:'POST',body:JSON.stringify(input)}),
    updateSession:(id:string,input:UpdateSessionInput)=>request<RueSession>(`/session/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}),
    deleteSession:(id:string)=>request<{deleted:boolean}>(`/session/${encodeURIComponent(id)}`,{method:'DELETE'}),
    messages:(id:string)=>request<RueMessage[]>(`/session/${encodeURIComponent(id)}/messages`),
    parts:(id:string)=>request<RuePart[]>(`/session/${encodeURIComponent(id)}/parts`),
    sendMessage:(id:string,input:SendMessageInput)=>request<SendMessageResult>(`/session/${encodeURIComponent(id)}/message`,{method:'POST',body:JSON.stringify(input)}),
    registerDevice:(input:RueDeviceInput)=>request<RueDevice>('/device/register',{method:'POST',body:JSON.stringify(input)}),
    devices:()=>request<RueDevice[]>('/device'),
    revokeDevice:(id:string)=>request<{revoked:boolean}>(`/device/${encodeURIComponent(id)}`,{method:'DELETE'}),
    createPairing:(input:RueDeviceInput)=>request<RuePairing>('/pairing',{method:'POST',body:JSON.stringify(input)}),
    pairingStatus:(id:string)=>request<RuePairingStatus>(`/pairing/${encodeURIComponent(id)}`),
    redeemPairing:(input:RueDeviceInput&({token:string}|{code:string}))=>request<{device:RueDevice;pairingId:string;synced:boolean}>('/pairing/redeem',{method:'POST',body:JSON.stringify(input)}),
    preferences:()=>request<RuePreference[]>('/sync/preferences'),
    setPreference:(key:string,input:{value:unknown;deviceId?:string;expectedVersion?:number})=>request<RuePreference>(`/sync/preferences/${encodeURIComponent(key)}`,{method:'PUT',body:JSON.stringify(input)}),
    events:(signal?:AbortSignal)=>createRueEventStream(`${baseUrl}/event`,options.token,requestFetch,signal),
    request,
  }
}

async function* createRueEventStream(url:string,token:RueClientOptions['token'],requestFetch:typeof globalThis.fetch,signal?:AbortSignal):AsyncGenerator<RueEvent>{const supplied=typeof token==='function'?await token():token;const response=await requestFetch(url,{headers:supplied?{authorization:`Bearer ${supplied}`}:{},signal});if(!response.ok||!response.body)throw new RueApiError(response.status,await response.text());const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';try{while(true){const{done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=block.split('\n').filter((line)=>line.startsWith('data:')).map((line)=>line.slice(5).trim()).join('');if(!data)continue;try{const event=JSON.parse(data) as RueEvent;if(event.type)yield event}catch{}}}}finally{reader.releaseLock()}}

export class RueApiError extends Error { constructor(public readonly status:number,public readonly body:string){super(`Rue API request failed (${status})`);this.name='RueApiError'} }
