import type {RuntimeGrant} from './config.js'
/** Independent guardian clock. Successful checks do not renew server authority. */
export class AuthorityClock {
 private mono=0;private wall=0;private lastWall=0
 private startupMono:number|undefined;private startupWall:number|undefined;private relaySeen=false
 accept(value:unknown,grant:RuntimeGrant,startedMono:number,startedWall:number){
  const v=value as {serverNow:number;expiresAt:number;relayExpiresAt:number|null;id:string;piSessionId:string;ownerSubject:string}
  let ttl=v?.expiresAt-v?.serverNow
  if(v?.id!==grant.connectionId||v.piSessionId!==grant.piSessionId||v.ownerSubject!==grant.ownerSubject||!Number.isSafeInteger(v.serverNow)||!Number.isSafeInteger(v.expiresAt)||ttl<=1000||ttl>60000)throw Error('agent_authority_invalid')
  if(v.relayExpiresAt!==null){
   if(!Number.isSafeInteger(v.relayExpiresAt)||v.relayExpiresAt-v.serverNow<=1000)throw Error('agent_authority_invalid')
   ttl=Math.min(ttl,v.relayExpiresAt-v.serverNow);this.relaySeen=true
  }else if(this.relaySeen)throw Error('agent_authority_invalid')
  this.startupMono??=startedMono+59000;this.startupWall??=startedWall+59000
  // A blocked Pi/MCP event loop cannot live on worker authority alone. Bootstrap
  // gets one bounded window; once attached, the relay lease must also stay live.
  this.mono=Math.min(startedMono+ttl-1000,v.relayExpiresAt===null?this.startupMono:Infinity)
  this.wall=Math.min(startedWall+ttl-1000,v.relayExpiresAt===null?this.startupWall:Infinity);this.lastWall=startedWall
 }
 valid(mono=performance.now(),wall=Date.now()){
  const result=mono<this.mono&&wall<this.wall&&wall>=this.lastWall-1000
  this.lastWall=wall
  return result
 }
}
export async function readAuthority(grant:RuntimeGrant,clock:AuthorityClock,fetcher:typeof fetch=fetch){
 const mono=performance.now(),wall=Date.now()
 const response=await fetcher(`${grant.origin}/terminal-client/connections/${grant.connectionId}/authority`,{headers:{authorization:`Bearer ${grant.token}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)})
 if(!response.ok){await response.body?.cancel();throw Error(response.status===401||response.status===403||response.status===404?'agent_authority_rejected':'agent_authority_unavailable')}
 const reader=response.body?.getReader();if(!reader)throw Error('agent_authority_unavailable')
 const chunks:Uint8Array[]=[];let bytes=0
 try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>8192)throw Error('agent_authority_invalid');chunks.push(r.value)}}finally{await reader.cancel();reader.releaseLock()}
 const body=Buffer.concat(chunks).toString('utf8')
 let value:unknown
 try{value=JSON.parse(body)}catch{throw Error('agent_authority_invalid')}
 clock.accept(value,grant,mono,wall)
 if(!clock.valid())throw Error('agent_authority_rejected')
}
