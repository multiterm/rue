import type {RuePlatformAccess} from './platform-access.js'
export type {RuePlatformAccess} from './platform-access.js'
import type {RueManagedConfigureInput,RueManagedUpgradeInput} from './managed-agents.js'
export type {RueManagedConfigureInput,RueManagedUpgradeInput} from './managed-agents.js'
import type {RueApiKey,RueApiKeyInput,RueApiKeyOwner} from './api-keys.js'
export * from './api-keys.js'
export * from './cli-login.js'
export * from './filesystem.js'
import type { RueManagedAgent, RueManagedAgentConfig, RueManagedAction, RueManagedOperation } from './managed-agents.js'
export type { RueManagedAgent, RueManagedAgentConfig, RueManagedAction, RueManagedOperation } from './managed-agents.js'
import type { RueWorker, RueWorkerAction } from './workers.js'
export type { RueWorker, RueWorkerHealth, RueWorkerLease, RueWorkerAction } from './workers.js'
import { createRueEventStream } from './events.js'
import { RueApiError } from './errors.js'
export { RueApiError } from './errors.js'

export type RueKeyProvider = string
export interface RueMcpProfile {id:string;name:string;transport:'stdio';command:string;args:string[];environmentNames:string[];revision:number;createdAt:number;revokedAt:number|null}
export interface RueKeyTarget { type:'terminal'|'worker'; id:string }
export type RueCredentialProvider=RueKeyProvider|'openai-codex'
export interface RueOAuthMetadata {ownerSubject:string;provider:'openai-codex';credentialType:'oauth';configured:boolean;revision:number;grants?:Array<{type:'terminal';id:string}>;expiresAt:number|null;state:'ready'|'refreshing'|'reauthorize'|'removed';keyStorageAvailable:boolean;runtimeSupported:boolean}
export interface RueOAuthFlow {id:string;provider:'openai-codex';status:'starting'|'pending'|'authorizing'|'review'|'complete'|'cancelled'|'expired'|'failed';expiresAt:number;pollAfterMs:number;userCode?:string;verificationUri?:string;accountId?:string}
export interface RueProviderCatalog {managedProviders?:Array<{id:RueManagedAgentConfig['provider'];name:string;models:Array<{id:string;name:string;contextWindow:number}>}>;credentialProviders?:Array<{id:RueCredentialProvider;name:string;auth:'api_key'|'oauth'}>;providers:Array<{id:RueKeyProvider;name:string;models:Array<{id:string;name:string;contextWindow:number}>}>}
export interface RueProviderKey { model?:string|null;provider:RueKeyProvider; configured:boolean; revision:number; grants:RueKeyTarget[] }
export interface RueProviderKeys { ownerSubject:string; keyStorageAvailable:boolean; keys:RueProviderKey[];oauth?:RueOAuthMetadata }

export const RUE_SDK_VERSION = '0.2.0-b.0'

export interface RueClientOptions { baseUrl:string; token?:string|(()=>string|undefined|Promise<string|undefined>); fetch?:typeof globalThis.fetch; eventRetryMs?:number; eventMaxRetryMs?:number }
export interface RueAgentSettings { ownerSubject:string; harness:'pi'; provider:'openai'; model:string; systemPrompt:string; revision:number; apiKeyConfigured:boolean; keyStorageAvailable:boolean; models:string[] }
export interface RueAgentSettingsInput { expectedOwnerSubject:string; harness:'pi'; provider:'openai'; model:string; systemPrompt:string; expectedRevision:number; apiKey?:string|null }
export interface RueTerminalConnection { id:string; ownerSubject:string; sessionId:string; piSessionId:string; expiresAt:number; activatedAt:number|null; revokedAt:number|null }
export interface RueCompaction {id:string;agentId:string;kind:'compact';revision:number;status:'queued'|'assigned'|'running'|'succeeded'|'failed'|'cancelled'|'uncertain';createdAt:number;expiresAt:number;startedAt:number|null;completedAt:number|null}
export type {RueAgentStatus} from './agent-status.js'
export * from './runtime-rollouts.js'
export * from './runtime-control.js'
export interface RueRemoteComputer { managedAgentId?:string; serverNow?:number; relayProtocol?:number; leaseExpiresAt?:number|null; health?:{status?:import('./agent-status.js').RueAgentStatus;transport?:'websocket'|'https';agentWorking?:boolean;uploadFailures:number;retries:number;lastUploadAt:number|null;pendingCount:number;pendingBytes:number;pollLatencyMs:number}|null; id:string; ownerSubject:string; sessionId:string; name:string; revision:number; remoteEnabled:boolean; lastSeenAt:number|null; expiresAt:number; status:string; runs:Array<{id:string;status:string;userMessageId?:string;expiredBeforeDispatch?:boolean;created_at:number;updated_at:number}> }
export interface RueRecoverableQueuedMessage {id:string;text:string;user_message_id:string;created_at:number;updated_at:number}
export interface RueQueuedMessage { id:string; text:string; status:'queued'|'claimed'|'running'; user_message_id:string; created_at:number; updated_at:number }
export interface RueTerminalApproval { code:string; expiresAt:number; ownerSubject:string }
export interface RueHealth { ok:boolean; version:string; authentication?:'keyname'|'password'|'none' }
export interface RueSession { terminalConnectionId?:string|null; id:string; title:string; agent:string|null; provider:string|null; model:string|null; directory:string|null; scopes:string[]; parentId:string|null; ownerSubject:string; createdAt:number; updatedAt:number; meta:Record<string,unknown> }
export interface RueMessage { id:string; sessionId:string; role:'user'|'assistant'|'system'; time:number; provider:string|null; model:string|null; agent:string|null; meta:Record<string,unknown>; seq:number }
export interface RuePart { id:string; sessionId:string; messageId:string; type:string; seq:number; payload:Record<string,unknown> }
export interface CreateSessionInput { title?:string; agent?:string; provider?:string; model?:string; directory?:string; scopes?:string[]; parentId?:string; meta?:Record<string,unknown> }
export interface UpdateSessionInput extends CreateSessionInput {}
export type RueMessageContent = {type:'text';text:string}|{type:'file';name:string;mimeType:string;data:string}
export interface SendMessageInput { text:string; content?:RueMessageContent[]; provider?:string; model?:string; systemPrompt?:string; wait?:boolean; requestId?:string }
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
    platformAccess:()=>request<RuePlatformAccess>('/platform/access',{cache:'no-store',redirect:'error'}),
    providerCatalog:()=>request<RueProviderCatalog>('/provider-keys/catalog',{cache:'no-store'}),
    codexOAuth:()=>request<RueOAuthMetadata>('/provider-oauth/openai-codex',{cache:'no-store'}),
    startCodexOAuth:(input:{expectedOwnerSubject:string;expectedRevision:number;requestId:string;acknowledgeStorage:true})=>request<RueOAuthFlow>('/provider-oauth/openai-codex/start',{method:'POST',body:JSON.stringify(input),redirect:'error',cache:'no-store'}),
    codexOAuthFlow:(id:string)=>request<RueOAuthFlow>(`/provider-oauth/openai-codex/flows/${encodeURIComponent(id)}`,{cache:'no-store'}),
    codexOAuthAction:(id:string,action:'poll'|'confirm'|'cancel',expectedOwnerSubject:string)=>request<RueOAuthFlow>(`/provider-oauth/openai-codex/flows/${encodeURIComponent(id)}/${action}`,{method:'POST',body:JSON.stringify({expectedOwnerSubject,...(action==='confirm'?{acknowledgeAccount:true}:{})}),redirect:'error',cache:'no-store'}),
    grantCodexOAuth:(input:{expectedOwnerSubject:string;expectedRevision:number;target:{type:'terminal';id:string};enabled:boolean;acknowledgeExposure:true})=>request<RueOAuthMetadata>('/provider-oauth/openai-codex/grants',{method:'PUT',body:JSON.stringify(input),redirect:'error',cache:'no-store'}),
    disconnectCodexOAuth:(expectedOwnerSubject:string,expectedRevision:number)=>request<RueOAuthMetadata>('/provider-oauth/openai-codex',{method:'DELETE',body:JSON.stringify({expectedOwnerSubject,expectedRevision}),redirect:'error',cache:'no-store'}),
    providerKeys:()=>request<RueProviderKeys>('/provider-keys',{cache:'no-store'}),
    saveProviderKey:(provider:RueKeyProvider,input:{expectedOwnerSubject:string;expectedRevision:number;apiKey:string|null;model?:string})=>request<RueProviderKeys>(`/provider-keys/${provider}`,{method:'PUT',body:JSON.stringify(input),redirect:'error'}),
    grantProviderKey:(provider:RueKeyProvider,input:{expectedOwnerSubject:string;expectedRevision:number;target:RueKeyTarget;enabled:boolean;acknowledgeExposure:true})=>request<RueProviderKeys>(`/provider-keys/${provider}/grants`,{method:'PUT',body:JSON.stringify(input),redirect:'error'}),
    mcpProfiles:()=>request<{ownerSubject:string;profiles:RueMcpProfile[]}>('/mcp',{cache:'no-store'}),
    createMcpProfile:(id:string,input:{expectedOwnerSubject:string;name:string;command:string;args:string[];environment:Record<string,string>;acknowledgeTools:true})=>request<{profile:RueMcpProfile}>(`/mcp/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(input),redirect:'error',cache:'no-store'}),
    removeMcpProfile:(id:string,expectedRevision:number)=>request<{profile:RueMcpProfile;stoppedAgents:string[]}>(`/mcp/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({expectedRevision}),redirect:'error',cache:'no-store'}),
    managedAgents:()=>request<{agents:RueManagedAgent[]}>('/managed-agents',{cache:'no-store'}),
    createManagedAgent:(input:{requestId:string;workerId:string;name:string;acknowledgeExecution:true;acknowledgeFilesystem?:true;config:RueManagedAgentConfig})=>request<{agent:RueManagedAgent;operation:RueManagedOperation}>('/managed-agents',{method:'POST',body:JSON.stringify(input),redirect:'error'}),
    changeManagedAgent:(id:string,input:{requestId:string;expectedRevision:number;action:RueManagedAction;image?:string;expectedImage?:string;piVersion?:string;acknowledgePurge?:true;config?:RueManagedAgentConfig;acknowledgeExecution?:true;acknowledgeFilesystem?:true},signal?:AbortSignal)=>request<{agent:RueManagedAgent;operation:RueManagedOperation}>(`/managed-agents/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input),redirect:'error',signal}),
    configureManagedAgent:(id:string,input:RueManagedConfigureInput)=>request<{agent:RueManagedAgent;operation:RueManagedOperation}>(`/managed-agents/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({...input,action:'configure'}),redirect:'error'}),
    upgradeManagedAgent:(id:string,input:RueManagedUpgradeInput)=>request<{agent:RueManagedAgent;operation:RueManagedOperation}>(`/managed-agents/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({...input,action:'upgrade'}),redirect:'error'}),
    managedCompactions:(id:string)=>request<{commands:RueCompaction[]}>(`/managed-agents/${encodeURIComponent(id)}/compactions`,{cache:'no-store'}),
    compactManagedAgent:(id:string,input:{requestId:string;expectedRevision:number;acknowledgeModelUse:true})=>request<RueCompaction>(`/managed-agents/${encodeURIComponent(id)}/compactions`,{method:'POST',body:JSON.stringify(input),redirect:'error'}),
    managedOperations:(id:string)=>request<{operations:RueManagedOperation[]}>(`/managed-agents/${encodeURIComponent(id)}/operations`,{cache:'no-store'}),
    workers:()=>request<{workers:RueWorker[]}>('/workers',{cache:'no-store'}),
    apiKeyOwners:()=>request<{owners:Array<{owner:RueApiKeyOwner;label:string}>}>('/api-keys/owners'),
    apiKeys:(owner:RueApiKeyOwner={type:'self'})=>request<{keys:RueApiKey[]}>('/api-keys'+(owner.type==='project'?'?'+new URLSearchParams({organizationId:owner.organizationId,projectId:owner.projectId}):'')),
    createApiKey:(input:RueApiKeyInput)=>request<RueApiKey&{token?:string}>('/api-keys',{method:'POST',body:JSON.stringify(input),redirect:'error'}),
    revokeApiKey:(id:string)=>request<void>('/api-keys/'+encodeURIComponent(id),{method:'DELETE',redirect:'error'}),
    createWorker:(input:{expectedOwnerSubject?:string;name:string;requestId:string;acknowledgeHostControl:true})=>request<{worker:RueWorker;secret?:string}>('/workers',{method:'POST',body:JSON.stringify(input),redirect:'error'}),
    changeWorker:(id:string,input:{action:RueWorkerAction;expectedRevision:number})=>request<{worker:RueWorker;secret?:string}>(`/workers/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input),redirect:'error'}),
    agentSettings:()=>request<RueAgentSettings>('/agent/settings'),
    saveAgentSettings:(input:RueAgentSettingsInput)=>request<RueAgentSettings>('/agent/settings',{method:'PUT',body:JSON.stringify(input)}),
    approveTerminalPairing:(id:string,input:{expectedOwnerSubject:string;botName:string})=>request<RueTerminalApproval>(`/terminal/requests/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify(input),redirect:'error'}),
    computerCatalog:(id:string)=>request<{ownerSubject:string;connectionId:string;sessionId:string;piVersion:string|null;catalog:import('./agent-status.js').RueAgentStatus['catalog']|null;catalogHash:string|null;observedAt:number|null}>(`/terminal/computers/${encodeURIComponent(id)}/catalog`,{cache:'no-store'}),
    remoteComputers:(signal?:AbortSignal)=>request<{computers:RueRemoteComputer[]}>('/terminal/computers',{cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)}),
    syncComputer:(id:string,expectedSessionId:string)=>request<{requestedAt:number;agentOnline:boolean;sessionId:string}>(`/terminal/computers/${encodeURIComponent(id)}/sync`,{method:'POST',body:JSON.stringify({expectedSessionId}),redirect:'error',cache:'no-store'}),
    computerQueue:(id:string)=>request<{messages:RueQueuedMessage[];recoverableCount?:number}>(`/terminal/computers/${encodeURIComponent(id)}/queue`,{cache:'no-store'}),
    configureComputer:(id:string,input:{expectedOwnerSubject:string;name:string;remoteEnabled:boolean;expectedRevision:number})=>request<{updated:true}>(`/terminal/computers/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input),redirect:'error'}),
    terminalConnections:()=>request<{connections:RueTerminalConnection[]}>('/terminal/connections'),
    revokeTerminalConnection:(id:string)=>request<{revoked:boolean}>(`/terminal/connections/${encodeURIComponent(id)}`,{method:'DELETE'}),
    sessions:()=>request<RueSession[]>('/session'),
    session:(id:string,signal?:AbortSignal)=>request<RueSession>(`/session/${encodeURIComponent(id)}`,{signal,cache:'no-store'}),
    createSession:(input:CreateSessionInput={})=>request<RueSession>('/session',{method:'POST',body:JSON.stringify(input)}),
    updateSession:(id:string,input:UpdateSessionInput)=>request<RueSession>(`/session/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}),
    agentUsage:(id:string,days:7|30|90=30)=>request<{ownerSubject:string;sessionId:string;from:number;to:number;timezone:'UTC';basis:'runtime-estimate';rows:Array<{time:number;provider:string;credentialId:string|null;requests:number;input:number;output:number;cacheRead:number;cacheWrite:number;costUsd:number|null;unpricedRequests:number}>}>(`/session/${encodeURIComponent(id)}/usage?days=${days}`,{cache:'no-store'}),
    clearSessionHistory:(id:string,expectedLastMessageId:string|null)=>request<{cleared:boolean}>(`/session/${encodeURIComponent(id)}/history`,{method:'DELETE',body:JSON.stringify({expectedLastMessageId})}),
    deleteSession:(id:string)=>request<{deleted:boolean}>(`/session/${encodeURIComponent(id)}`,{method:'DELETE'}),
    messages:(id:string,signal?:AbortSignal)=>request<RueMessage[]>(`/session/${encodeURIComponent(id)}/messages`,{cache:'no-store',signal}),
    parts:(id:string,signal?:AbortSignal)=>request<RuePart[]>(`/session/${encodeURIComponent(id)}/parts`,{cache:'no-store',signal}),
    recoverableQueueMessages:(id:string)=>request<{messages:RueRecoverableQueuedMessage[]}>(`/terminal/computers/${encodeURIComponent(id)}/queue/recoverable`,{cache:'no-store'}),
    requeueExpiredMessage:(id:string,commandId:string,input:{expectedSessionId:string;acknowledgeRequeue:true},signal?:AbortSignal)=>request<{id:string;status:string;restored:boolean}>(`/terminal/computers/${encodeURIComponent(id)}/queue/${encodeURIComponent(commandId)}/requeue`,{method:'POST',body:JSON.stringify(input),signal}),
    attachment:async(id:string,partId:string):Promise<Blob>=>{const supplied=typeof options.token==='function'?await options.token():options.token;const response=await requestFetch(`${baseUrl}/session/${encodeURIComponent(id)}/attachments/${encodeURIComponent(partId)}`,{headers:supplied?{authorization:`Bearer ${supplied}`}:{},redirect:'error',cache:'no-store'});if(!response.ok)throw new RueApiError(response.status,await response.text());return response.blob()},
    sendMessage:(id:string,input:SendMessageInput)=>request<SendMessageResult>(`/session/${encodeURIComponent(id)}/message`,{method:'POST',body:JSON.stringify(input)}),
    registerDevice:(input:RueDeviceInput)=>request<RueDevice>('/device/register',{method:'POST',body:JSON.stringify(input)}),
    devices:()=>request<RueDevice[]>('/device'),
    revokeDevice:(id:string)=>request<{revoked:boolean}>(`/device/${encodeURIComponent(id)}`,{method:'DELETE'}),
    createPairing:(input:RueDeviceInput)=>request<RuePairing>('/pairing',{method:'POST',body:JSON.stringify(input)}),
    pairingStatus:(id:string)=>request<RuePairingStatus>(`/pairing/${encodeURIComponent(id)}`),
    redeemPairing:(input:RueDeviceInput&({token:string}|{code:string}))=>request<{device:RueDevice;pairingId:string;synced:boolean}>('/pairing/redeem',{method:'POST',body:JSON.stringify(input)}),
    runtimeControlGrant:(agentId:string)=>request<import('./runtime-control.js').RueRuntimeControlGrant>(`/runtime-rollouts/agents/${encodeURIComponent(agentId)}/grant`,{cache:'no-store'}),
    setRuntimeControlGrant:(agentId:string,input:import('./runtime-control.js').RueRuntimeControlGrantInput,signal?:AbortSignal)=>request<import('./runtime-control.js').RueRuntimeControlGrant>(`/runtime-rollouts/agents/${encodeURIComponent(agentId)}/grant`,{method:'PUT',body:JSON.stringify(input),signal}),
    rolloutOwnRuntime:(connectionId:string,input:import('./runtime-rollouts.js').RueRuntimeRolloutInput)=>request<import('./runtime-rollouts.js').RueRuntimeRollout>(`/terminal-client/connections/${encodeURIComponent(connectionId)}/runtime-control/rollouts`,{method:'POST',body:JSON.stringify(input)}),
    ownRuntimeRollout:(connectionId:string,id:string)=>request<import('./runtime-rollouts.js').RueRuntimeRollout>(`/terminal-client/connections/${encodeURIComponent(connectionId)}/runtime-control/rollouts/${encodeURIComponent(id)}`,{cache:'no-store'}),
    terminalRuntimeControl:(connectionId:string)=>request<{managed:boolean;canSubmit:boolean;approved?:boolean;blockedBy?:string|null;grantRevision?:number|null;grantExpiresAt?:number|null;workerId?:string;workerRevision?:number;managerVersion?:string|null;runtimeImage?:string|null;rolloutSupported?:boolean}>(`/terminal-client/connections/${encodeURIComponent(connectionId)}/runtime-control`,{cache:'no-store'}),
    latestPiRelease:()=>request<{latestVersion:string|null;checkedAt:number|null}>('/runtime-rollouts/pi-release',{cache:'no-store'}),
    runtimeRollouts:(workerId:string)=>request<{rollouts:import('./runtime-rollouts.js').RueRuntimeRollout[]}>(`/runtime-rollouts/hosts/${encodeURIComponent(workerId)}`,{cache:'no-store'}),
    runtimeRollout:(id:string)=>request<import('./runtime-rollouts.js').RueRuntimeRollout>(`/runtime-rollouts/${encodeURIComponent(id)}`,{cache:'no-store'}),
    cancelRuntimeRollout:(id:string)=>request<import('./runtime-rollouts.js').RueRuntimeRollout>(`/runtime-rollouts/${encodeURIComponent(id)}/cancel`,{method:'POST',body:'{}'}),
    resolveRuntimeRollout:(id:string,input:{expectedUpdatedAt:number;acknowledgeStopped:true})=>request<import('./runtime-rollouts.js').RueRuntimeRollout>(`/runtime-rollouts/${encodeURIComponent(id)}/resolve`,{method:'POST',body:JSON.stringify(input)}),
    rolloutRuntime:(workerId:string,input:import('./runtime-rollouts.js').RueRuntimeRolloutInput,signal?:AbortSignal)=>request<import('./runtime-rollouts.js').RueRuntimeRollout>(`/runtime-rollouts/hosts/${encodeURIComponent(workerId)}`,{method:'POST',body:JSON.stringify(input),signal}),
    notificationInbox:()=>request<{items:Array<{id:string;sessionId:string;kind:'task_completed'|'task_failed';createdAt:number;readAt:number|null}>;unread:number}>('/notifications',{cache:'no-store'}),
    readNotification:(id:string)=>request<{read:boolean}>(`/notifications/${encodeURIComponent(id)}/read`,{method:'POST'}),
    readAllNotifications:()=>request<{read:boolean}>('/notifications/read-all',{method:'POST'}),
    pushSettings:()=>request<{enabled:boolean;publicKey:string|null;devices:Array<{deviceId:string;expiresAt:number}>}>('/notifications/push',{cache:'no-store'}),
    savePushSubscription:(deviceId:string,subscription:{endpoint:string;keys:{p256dh:string;auth:string}})=>request<{id:string;deviceId:string;expiresAt:number}>(`/notifications/push/${encodeURIComponent(deviceId)}`,{method:'PUT',body:JSON.stringify(subscription)}),
    removePushSubscription:(deviceId:string,signal?:AbortSignal)=>request<{removed:boolean}>(`/notifications/push/${encodeURIComponent(deviceId)}`,{method:'DELETE',signal}),
    testPush:(deviceId:string)=>request<{accepted:boolean}>(`/notifications/push/${encodeURIComponent(deviceId)}/test`,{method:'POST'}),
    preferences:()=>request<RuePreference[]>('/sync/preferences'),
    setPreference:(key:string,input:{value:unknown;deviceId?:string;expectedVersion?:number})=>request<RuePreference>(`/sync/preferences/${encodeURIComponent(key)}`,{method:'PUT',body:JSON.stringify(input)}),
    events:(signal?:AbortSignal)=>createRueEventStream(`${baseUrl}/event`,options.token,requestFetch,signal,{retryMs:options.eventRetryMs,maxRetryMs:options.eventMaxRetryMs}),
    request,
  }
}
