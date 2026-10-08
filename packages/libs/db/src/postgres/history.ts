import {and,desc,eq} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {lockPostgresOwner} from './owner-lock.js'
import {HistoryError} from '../history-types.js'
import {sessions,messages,terminalConnections,managedAgents} from './schema.js'
/** Cloud-only history deletion. The application must also serialize this with
 * starting/active cloud runs; deleting a mirror cannot reset remote Pi memory. */
export function createPostgresHistoryRepository(db:RuePostgresDatabase){
 return {clear(owner:string,id:string,expectedLastMessageId:string|null,at?:number){return db.transaction(async tx=>{
  await lockPostgresOwner(tx,owner)
  const [session]=await tx.select().from(sessions).where(and(eq(sessions.id,id),eq(sessions.ownerSubject,owner))).for('update')
  if(!session)throw new HistoryError(404,'session_not_found')
  const [terminal]=await tx.select({id:terminalConnections.id}).from(terminalConnections).where(eq(terminalConnections.sessionId,id)).limit(1)
  const [managed]=await tx.select({id:managedAgents.id}).from(managedAgents).where(eq(managedAgents.sessionId,id)).limit(1)
  if(terminal||managed||session.agent==='pi-terminal')throw new HistoryError(409,'remote_history_reset_required')
  const [last]=await tx.select({id:messages.id}).from(messages).where(eq(messages.sessionId,id)).orderBy(desc(messages.seq)).limit(1)
  if((last?.id??null)!==expectedLastMessageId)throw new HistoryError(409,'history_changed')
  await tx.delete(messages).where(eq(messages.sessionId,id))
  await tx.update(sessions).set({updatedAt:at??Date.now()}).where(and(eq(sessions.id,id),eq(sessions.ownerSubject,owner)))
  return {cleared:true as const}
 })}}
}
