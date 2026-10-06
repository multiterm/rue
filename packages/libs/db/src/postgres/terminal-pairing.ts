import {createHash,randomBytes,randomInt,timingSafeEqual} from 'node:crypto'
import {and,count,desc,eq,getTableColumns,gt,inArray,isNull,lt,or,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {TerminalPairingError,type TerminalConnection} from '../terminal-types.js'
import {terminalPairingRequests as requests,terminalConnections as connections,terminalCommands as commands,managedAgents,sessions,parts} from './schema.js'
import {lockPostgresOwner} from './owner-lock.js'
import {clearPostgresProviderKeyGrants} from './provider-keys.js'
import {postgresManagedAuthority,ManagedAuthorityExpired} from './managed-authority.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
const PAIR_TTL=300000,TOKEN_TTL=7*86400000,MAX_ATTEMPTS=5,MAX_PENDING=100
const opaque=()=>randomBytes(24).toString('base64url'),hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const fail=(code:ConstructorParameters<typeof TerminalPairingError>[0]):never=>{throw new TerminalPairingError(code)}
const publicConnection=(row:typeof connections.$inferSelect):TerminalConnection=>({id:row.id,ownerSubject:row.ownerSubject,sessionId:row.sessionId,piSessionId:row.piSessionId,expiresAt:row.expiresAt,activatedAt:row.activatedAt,revokedAt:row.revokedAt})
const equal=(left:string,right:string)=>/^[a-f0-9]{64}$/.test(left)&&/^[a-f0-9]{64}$/.test(right)&&timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'))
const available=(row:typeof requests.$inferSelect|undefined,now:number)=>Boolean(row&&row.expiresAt>now&&row.consumedAt===null&&row.attempts<MAX_ATTEMPTS)
/** Internal authority primitive: all child writes must stay in the same transaction.
 * SQL ownership/parent locks precede the final credential and wall-clock check. */
export async function authenticatePostgresTerminal(tx:Tx,token:string,id?:string,at?:number,requireActivation=true){
 if(typeof token!=='string'||token.length!==56||!/^rue_terminal_[A-Za-z0-9_-]{43}$/.test(token))return fail('invalid_terminal_credential')
 const query=()=>tx.select(getTableColumns(connections)).from(connections).innerJoin(sessions,and(eq(sessions.id,connections.sessionId),eq(sessions.ownerSubject,connections.ownerSubject))).where(eq(connections.tokenHash,hash(token)))
 const [initial]=await query()
 if(!initial||(id!==undefined&&initial.id!==id))return fail('invalid_terminal_credential')
 await lockPostgresOwner(tx,initial.ownerSubject)
 const checkedAt=at??Date.now();let until:number|undefined
 try{until=await postgresManagedAuthority(tx,initial.id,initial.ownerSubject,checkedAt)}catch(error){if(error instanceof ManagedAuthorityExpired)return fail('invalid_terminal_credential');throw error}
 const [row]=await query().for('update',{of:connections}),now=at??Date.now()
 if(!row||row.id!==initial.id||row.ownerSubject!==initial.ownerSubject||row.revokedAt!==null||(requireActivation&&row.activatedAt===null)||now<checkedAt||Math.min(row.expiresAt,until??Infinity)<=now)return fail('invalid_terminal_credential')
 return {row:{...row,expiresAt:Math.min(row.expiresAt,until??Infinity)},now}
}
export function createPostgresTerminalPairingRepository(db:RuePostgresDatabase){
 async function revoke(tx:Tx,owner:string,id:string,now:number){
  const changed=await tx.update(connections).set({revokedAt:sql`COALESCE(${connections.revokedAt},${now})`}).where(and(eq(connections.id,id),eq(connections.ownerSubject,owner))).returning({id:connections.id})
  if(changed.length)await clearPostgresProviderKeyGrants(tx,owner,{type:'terminal',id},now)
  return changed.length===1
 }
 return {
  async request(challenge:string,piSessionId:string,at?:number){
   if(typeof challenge!=='string'||challenge.length!==64||!/^[a-f0-9]{64}$/.test(challenge)||typeof piSessionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(piSessionId))return fail('invalid_request')
   return db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('rue:terminal-pairing-queue',0))`)
    const now=at??Date.now()
    await tx.delete(requests).where(or(sql`${requests.expiresAt}<=${now}`,sql`${requests.consumedAt} IS NOT NULL`,sql`${requests.attempts}>=${MAX_ATTEMPTS}`))
    const [total]=await tx.select({n:count()}).from(requests).where(and(gt(requests.expiresAt,now),isNull(requests.consumedAt),lt(requests.attempts,MAX_ATTEMPTS)))
    if(total!.n>=MAX_PENDING)return fail('pairing_unavailable')
    const id=opaque(),expiresAt=now+PAIR_TTL
    await tx.insert(requests).values({id,verifierHash:challenge,piSessionId,expiresAt});return {requestId:id,expiresAt}
   })
  },
  async approve(requestId:string,owner:string,botName:string,at?:number){
   if(typeof owner!=='string'||!owner.length||owner.length>512||typeof botName!=='string'||!botName.trim()||botName.trim().length>60||/[\x00-\x1f\x7f]/.test(botName.trim()))return fail('invalid_request')
   return db.transaction(async tx=>{
    await lockPostgresOwner(tx,owner)
    const [row]=await tx.select().from(requests).where(eq(requests.id,requestId)).for('update'),now=at??Date.now()
    if(!available(row,now))return fail('invalid_pairing')
    if(row!.ownerSubject!==null)return fail('already_approved')
    const code=String(randomInt(0,1_000_000_000_000)).padStart(12,'0')
    await tx.update(requests).set({ownerSubject:owner,botName:botName.trim(),codeHash:hash(`${requestId}:${code}`)}).where(eq(requests.id,requestId))
    return {code,expiresAt:row!.expiresAt,ownerSubject:owner}
   })
  },
  async exchange(requestId:string,verifier:string,code:string,at?:number){
   if(typeof verifier!=='string'||verifier.length!==43||!/^[A-Za-z0-9_-]{43}$/.test(verifier)||typeof code!=='string'||code.length!==12||!/^\d{12}$/.test(code))return fail('invalid_pairing')
   const result=await db.transaction(async tx=>{
    const [initial]=await tx.select().from(requests).where(eq(requests.id,requestId))
    if(!initial?.ownerSubject)return
    await lockPostgresOwner(tx,initial.ownerSubject)
    const [row]=await tx.select().from(requests).where(eq(requests.id,requestId)).for('update');let now=at??Date.now()
    if(!available(row,now)||row!.ownerSubject!==initial.ownerSubject||!row!.codeHash||!row!.botName||!equal(row!.verifierHash,hash(verifier)))return
    if(!equal(row!.codeHash,hash(`${requestId}:${code}`))){await tx.update(requests).set({attempts:sql`${requests.attempts}+1`}).where(eq(requests.id,requestId));return}
    const owner=row!.ownerSubject!
    const [existing]=await tx.select().from(connections).where(and(eq(connections.ownerSubject,owner),eq(connections.piSessionId,row!.piSessionId))).for('update')
    const acceptedAt=at??Date.now();if(acceptedAt<now||!available(row,acceptedAt))return;now=acceptedAt
    if(existing&&existing.revokedAt===null&&existing.expiresAt>now)return fail('already_linked')
    const id=existing?.id??`term_${opaque()}`,sessionId=existing?.sessionId??`ses_${opaque()}`,token=`rue_terminal_${randomBytes(32).toString('base64url')}`,expiresAt=now+TOKEN_TTL
    if(existing){
     if(!Number.isSafeInteger(existing.settingsRevision)||existing.settingsRevision>=Number.MAX_SAFE_INTEGER)return fail('pairing_unavailable')
     await clearPostgresProviderKeyGrants(tx,owner,{type:'terminal',id},now)
     const unfinished=await tx.update(commands).set({status:'cancelled',updatedAt:now}).where(and(eq(commands.connectionId,id),inArray(commands.status,['queued','claimed','running']))).returning({assistant:commands.assistantMessageId,result:commands.result})
     for(const command of unfinished)await tx.update(parts).set({payload:{text:command.result||'[Remote run cancelled]',remoteStatus:'cancelled'}}).where(and(eq(parts.id,`txt_${command.assistant}`),eq(parts.messageId,command.assistant),eq(parts.sessionId,sessionId)))
     await tx.update(connections).set({tokenHash:hash(token),expiresAt,activatedAt:null,revokedAt:null,remoteEnabled:0,instanceId:null,leaseExpiresAt:null,lastSeenAt:null,relayHealth:null,settingsRevision:existing.settingsRevision+1,name:row!.botName!}).where(eq(connections.id,id))
    }else{
     await tx.insert(sessions).values({id:sessionId,ownerSubject:owner,title:row!.botName!,agent:'pi-terminal',createdAt:now,updatedAt:now,meta:{terminalConnectionId:id}})
     await tx.insert(connections).values({id,ownerSubject:owner,sessionId,piSessionId:row!.piSessionId,tokenHash:hash(token),expiresAt,createdAt:now,name:row!.botName!})
    }
    await tx.update(requests).set({consumedAt:now,codeHash:null}).where(eq(requests.id,requestId))
    return {id,ownerSubject:owner,sessionId,piSessionId:row!.piSessionId,token,expiresAt}
   })
   if(!result)return fail('invalid_pairing');return result
  },
  async activate(token:string,at?:number,confirmedOwner?:string){return db.transaction(async tx=>{
   const {row,now}=await authenticatePostgresTerminal(tx,token,undefined,at,false)
   if(confirmedOwner!==undefined&&confirmedOwner!==row.ownerSubject)return fail('invalid_terminal_credential')
   await tx.update(connections).set({activatedAt:row.activatedAt??now}).where(eq(connections.id,row.id));return publicConnection({...row,activatedAt:row.activatedAt??now})
  })},
  authenticate(token:string,id:string,at?:number){return db.transaction(async tx=>publicConnection((await authenticatePostgresTerminal(tx,token,id,at)).row))},
  /** Bearer-only HTTP control retains its protocol. Managed worker/project
   * authority and the token deadline are still fenced through commit. */
  withAuthority<T>(token:string,id:string,run:(tx:Tx,host:Awaited<ReturnType<typeof authenticatePostgresTerminal>>['row'])=>Promise<T>,at?:number){return db.transaction(async tx=>{
   const state=await authenticatePostgresTerminal(tx,token,id,at),result=await run(tx,state.row),now=at??Date.now()
   if(now<state.now||now>=state.row.expiresAt)return fail('invalid_terminal_credential')
   return result
  })},
  authority(token:string,id:string,at?:number){return db.transaction(async tx=>{
   const {row,now}=await authenticatePostgresTerminal(tx,token,id,at)
   const [managed]=await tx.select({id:managedAgents.id}).from(managedAgents).where(and(eq(managedAgents.connectionId,id),eq(managedAgents.ownerSubject,row.ownerSubject)))
   if(!managed)return undefined
   return {serverNow:now,expiresAt:row.expiresAt,relayExpiresAt:row.leaseExpiresAt,id:row.id,piSessionId:row.piSessionId,ownerSubject:row.ownerSubject}
  })},
  revokeWithConnection(token:string,id:string,at?:number){return db.transaction(async tx=>{
   const {row,now}=await authenticatePostgresTerminal(tx,token,id,at,false)
   return {revoked:await revoke(tx,row.ownerSubject,id,now),connection:publicConnection({...row,revokedAt:row.revokedAt??now})}
  })},
  revokeCredential(token:string,id:string,at?:number){return db.transaction(async tx=>{const {row,now}=await authenticatePostgresTerminal(tx,token,id,at,false);return revoke(tx,row.ownerSubject,id,now)})},
  revoke(owner:string,id:string,at?:number){return db.transaction(async tx=>{await lockPostgresOwner(tx,owner);return revoke(tx,owner,id,at??Date.now())})},
  async list(owner:string){return (await db.select().from(connections).where(eq(connections.ownerSubject,owner)).orderBy(desc(connections.createdAt),connections.id)).map(publicConnection)},
 }
}
