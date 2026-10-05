import type {RueManagedAgent,RueRemoteComputer,RueSession} from '@multiterm/rue-sdk'
const member=(value:unknown,allowed:string[])=>typeof value==='string'&&allowed.includes(value)?value:'unknown'
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null
const date=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=8640000000000000?new Date(value).toISOString():null
const identifier=(value:unknown)=>typeof value==='string'&&/^[a-z0-9][a-z0-9._:/-]{0,127}$/i.test(value)&&!/(?:https?:|sk-|tnk_|rue_worker_|eyJ)/i.test(value)?value:null
/** Export only diagnostic metadata. Never serialize whole status/error/config objects. */
export function agentDiagnostics(session:RueSession,computer:RueRemoteComputer|undefined,agent:RueManagedAgent|undefined,fresh:boolean,checkFailed:boolean,now=Date.now()){
 const expected=session.terminalConnectionId??session.meta.terminalConnectionId
 const c=computer?.sessionId===session.id&&computer.ownerSubject===session.ownerSubject&&(!expected||computer.id===expected)?computer:undefined
 const a=agent&&agent.id===session.meta.managedAgentId&&agent.sessionId===session.id&&c&&agent.connectionId===c.id?agent:undefined
 const s=c?.health?.status
 return JSON.stringify({reportVersion:1,capturedAt:date(now),check:checkFailed?'failed':!c?'not-reported':fresh?'fresh':'stale',connection:{state:member(c?.status,['online','offline','disconnected','expired','revoked','unconfirmed']),lastHeartbeatAt:date(c?.lastSeenAt),leaseExpiresAt:date(c?.leaseExpiresAt),transport:member(c?.health?.transport,['https','websocket']),uploadFailures:number(c?.health?.uploadFailures)},runtime:{piVersion:typeof s?.piVersion==='string'&&/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(s.piVersion)?s.piVersion:null,state:member(s?.state,['idle','working','compacting']),provider:identifier(s?.provider),model:identifier(s?.model),contextPercent:number(s?.context?.percent),contextTokens:number(s?.context?.tokens),contextWindow:number(s?.context?.window)},managed:a?{desired:member(a.desired,['running','stopped','destroyed']),observed:member(a.observed,['pending','starting','running','stopped','destroyed','purged','failed']),revision:number(a.revision),observedRevision:number(a.observedRevision),errorDetected:Boolean(a.error),updateState:member(a.runtimeUpdateState,['updating','rolling_back','updated','rolled_back','failed','cancelled'])}:null},null,2)
}
