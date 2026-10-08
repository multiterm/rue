import type {Database} from 'better-sqlite3'
import {createPostgresTerminalPairingRepository,createPostgresTerminalRelayRepository,createPostgresUsageRepository,type RuePostgresDatabase,type TerminalConnection} from '@multiterm/rue-db/postgres'
import * as pairing from '../storage/terminal-pairing.js'
import * as relay from '../storage/terminal-relay.js'
import {managedAuthority} from '../storage/managed-agents.js'
import {getSession} from '../storage/sessions.js'
import {recordAgentUsage,usageEventSchema} from '../storage/agent-usage.js'
import {postgresRelayOptions,relayHealthSchema} from '../storage/relay-health.js'
export interface TerminalServices {
 pairing:Omit<ReturnType<typeof createPostgresTerminalPairingRepository>,'withAuthority'>
 relay:Omit<ReturnType<typeof createPostgresTerminalRelayRepository>,'withSocketAuthority'>
 recordUsage(auth:{id:string;token:string;instance:string},event:unknown):Promise<boolean>
}
export function createPostgresTerminalServices(db:RuePostgresDatabase,encryptionKey:()=>Buffer|undefined):TerminalServices {
 const relay=createPostgresTerminalRelayRepository(db,postgresRelayOptions),usage=createPostgresUsageRepository(db,{parseEvent:value=>usageEventSchema.parse(value),encryptionKey})
 return {pairing:createPostgresTerminalPairingRepository(db),relay,recordUsage(auth,event){return relay.withSocketAuthority(auth.token,auth.id,auth.instance,(tx,host)=>usage.recordInTransaction(tx,host.ownerSubject,host.sessionId,host.id,event))}}
}
export function createSqliteTerminalServices(db:Database):TerminalServices {
 return {
  pairing:{
   async request(...args){return pairing.requestTerminalPairing(db,...args)},
   async approve(...args){return pairing.approveTerminalPairing(db,...args)},
   async exchange(...args){return pairing.exchangeTerminalPairing(db,...args)},
   async activate(...args){return pairing.activateTerminalConnection(db,...args)},
   async authenticate(...args){return pairing.authenticateTerminalConnection(db,...args)},
   async list(...args){return pairing.listTerminalConnections(db,...args)},
   async revoke(...args){return pairing.revokeTerminalConnection(db,...args)},
   async revokeCredential(...args){return pairing.revokeTerminalCredential(db,...args)},
   async revokeWithConnection(...args){return db.transaction(()=>{
    const revoked=pairing.revokeTerminalCredential(db,...args)
    const connection=db.prepare('SELECT id,owner_subject AS ownerSubject,session_id AS sessionId,pi_session_id AS piSessionId,expires_at AS expiresAt,activated_at AS activatedAt,revoked_at AS revokedAt FROM terminal_connections WHERE id=?').get(args[1]) as TerminalConnection
    return {revoked,connection}
   }).immediate()},
   async authority(token,id,at){return db.transaction(()=>{
    const now=at??Date.now(),connection=pairing.authenticateTerminalConnection(db,token,id,now)
    if(managedAuthority(db,id,now)===undefined)return undefined
    const row=db.prepare('SELECT lease_expires_at FROM terminal_connections WHERE id=?').get(id) as {lease_expires_at:number|null}
    return {serverNow:now,expiresAt:connection.expiresAt,relayExpiresAt:row.lease_expires_at,id:connection.id,piSessionId:connection.piSessionId,ownerSubject:connection.ownerSubject}
   }).immediate()},
  },
  relay:{
   async list(...args){return relay.remoteComputers(db,...args)},
   async configure(...args){relay.configureComputer(db,...args)},
   async attach(...args){return relay.attachComputer(db,...args)},
   async validateSocket(...args){return relay.validateRelaySocket(db,...args)},
   async poll(token,id,instance,now,protocol,health){return relay.pollComputer(db,token,id,instance,now,protocol,health?relayHealthSchema.parse(health):undefined)},
   async enqueue(...args){return relay.enqueueTerminalPrompt(db,...args)},
   async transition(...args){return relay.transitionCommand(db,...args)},
   async input(...args){return relay.terminalCommandInput(db,...args)},
   async publish(...args){return relay.publishCommand(db,...args)},
   async receipts(...args){return relay.terminalMirrorReceipts(db,...args)},
   async mirror(...args){return relay.mirrorTerminalText(db,...args)},
   async reconcileSession(owner,id){if(getSession(db,id,owner))relay.reconcileTerminalSession(db,id)},
   async queue(...args){return relay.computerQueue(db,...args)},
   async catalog(...args){return relay.computerCatalog(db,...args)},
   async recoverableCount(...args){return relay.recoverableQueuedCount(db,...args)},
   async recoverableMessages(...args){return relay.recoverableQueuedMessages(db,...args)},
   async restoreQueue(...args){return relay.restoreExpiredQueuedPrompt(db,...args)},
  },
  async recordUsage(auth,event){return db.transaction(()=>{
   const connection=relay.validateRelaySocket(db,auth.token,auth.id,auth.instance)
   return recordAgentUsage(db,connection.ownerSubject,connection.sessionId,auth.id,usageEventSchema.parse(event))
  }).immediate()},
 }
}
