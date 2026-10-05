import type {RueRemoteComputer} from '@multiterm/rue-sdk'

/** Display freshness only; never extends server execution authority. Protocol 2
 * owns a renewable lease, not the legacy heartbeat deadline. */
export function remoteObservationRemaining(computer:RueRemoteComputer|undefined,observedAt?:number,wallNow=Date.now()){
 if(computer?.status!=='online')return 0
 const age=observedAt==null?0:Math.max(0,wallNow-observedAt)
 const serverNow=computer.serverNow==null?wallNow:computer.serverNow+age
 const deadline=computer.relayProtocol===2
  ? computer.leaseExpiresAt
  : computer.lastSeenAt==null?null:computer.lastSeenAt+30_000
 if(deadline==null||!Number.isFinite(deadline)||!Number.isFinite(serverNow))return 0
 const expires=computer.expiresAt
 return Math.max(0,Math.min(deadline,Number.isFinite(expires)?expires:deadline)-serverNow)
}
