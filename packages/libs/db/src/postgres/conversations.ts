import {and,asc,eq,ne} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {sessions,messages,parts,preferences,managedAgents,terminalConnections} from './schema.js'
import {lockPostgresOwner} from './owner-lock.js'
import {appendPostgresMessage,appendPostgresPart,replacePostgresPart,checkPostgresAttachmentBudget,appendPostgresContent} from './conversation-writes.js'
import {createPostgresSessionRepository} from './sessions.js'
import type {MessageContent} from '../attachment-types.js'
import type {SessionRecord} from '../session-repository.js'

type SessionInput=Pick<typeof sessions.$inferInsert,'id'|'title'|'agent'|'provider'|'model'|'directory'|'scopes'|'parentId'|'meta'>
type SessionPatch=Partial<Pick<SessionInput,'title'|'agent'|'provider'|'model'|'directory'|'scopes'|'meta'>>
type MessageInput=Parameters<typeof appendPostgresMessage>[2]
type PartInput=Parameters<typeof appendPostgresPart>[2]
export class ConversationError extends Error {
 constructor(public readonly status:404|409|503,public readonly code:'session_not_found'|'message_not_found'|'managed_agent_destroy_required'|'terminal_transport_unavailable'){super(code)}
}
/** All mutations share the owner lock used by managed execution and history reset.
 * Message + attachment insertion is one transaction; publish events only after it resolves. */
export function createPostgresConversationRepository(db:RuePostgresDatabase){
 const read=createPostgresSessionRepository(db)
 return {
  ...read,
  snapshot(owner:string,sessionId:string):Promise<{messages:Array<typeof messages.$inferSelect>;parts:Array<typeof parts.$inferSelect>}>{return db.transaction(async tx=>{
   const store=createPostgresConversationRepository(tx)
   return {messages:await store.listMessages(owner,sessionId),parts:await store.listSessionParts(owner,sessionId)}
  },{isolationLevel:'repeatable read',accessMode:'read only'})},
  create(owner:string,input:SessionInput):Promise<SessionRecord>{return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner)
   const now=Date.now()
   const [row]=await tx.insert(sessions).values({...input,ownerSubject:owner,createdAt:now,updatedAt:now}).returning()
   return {...row!,terminalConnectionId:null}
  })},
  update(owner:string,id:string,patch:SessionPatch){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner)
   // Do not read/merge/write an unlocked stale copy of unrelated fields.
   const [row]=await tx.update(sessions).set({...patch,updatedAt:Date.now()}).where(and(eq(sessions.id,id),eq(sessions.ownerSubject,owner))).returning()
   return row?createPostgresSessionRepository(tx).get(owner,id):undefined
  })},
  delete(owner:string,id:string){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner)
   const [managed]=await tx.select({id:managedAgents.id}).from(managedAgents).where(and(eq(managedAgents.ownerSubject,owner),eq(managedAgents.sessionId,id),ne(managedAgents.desired,'destroyed'))).limit(1)
   if(managed)throw new ConversationError(409,'managed_agent_destroy_required')
   return (await tx.delete(sessions).where(and(eq(sessions.id,id),eq(sessions.ownerSubject,owner))).returning({id:sessions.id})).length>0
  })},
  beginCloud(owner:string,input:{sessionId:string;userMessageId:string;assistantMessageId:string;textPartId:string;text:string;provider:string;model:string;content?:MessageContent[]}){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner)
   const [session]=await tx.select().from(sessions).where(and(eq(sessions.id,input.sessionId),eq(sessions.ownerSubject,owner))).for('update')
   if(!session)throw new ConversationError(404,'session_not_found')
   const [terminal]=await tx.select({id:terminalConnections.id}).from(terminalConnections).where(eq(terminalConnections.sessionId,input.sessionId)).limit(1)
   const [managed]=await tx.select({id:managedAgents.id}).from(managedAgents).where(eq(managedAgents.sessionId,input.sessionId)).limit(1)
   if(terminal||managed||session.agent==='pi-terminal'||session.meta.terminalConnectionId)throw new ConversationError(503,'terminal_transport_unavailable')
   await checkPostgresAttachmentBudget(tx,owner,input.content)
   const user=await appendPostgresMessage(tx,owner,{id:input.userMessageId,sessionId:input.sessionId,role:'user'})
   if(input.content)await appendPostgresContent(tx,owner,input.sessionId,user.id,input.content)
   else await appendPostgresPart(tx,owner,{id:input.textPartId,sessionId:input.sessionId,messageId:user.id,type:'text',payload:{text:input.text}})
   const assistant=await appendPostgresMessage(tx,owner,{id:input.assistantMessageId,sessionId:input.sessionId,role:'assistant',provider:input.provider,model:input.model})
   return {user,assistant}
  })},
  appendMessage(owner:string,input:MessageInput,content?:MessageContent[]){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner)
   if(!await createPostgresSessionRepository(tx).get(owner,input.sessionId))throw new ConversationError(404,'session_not_found')
   await checkPostgresAttachmentBudget(tx,owner,content)
   const message=await appendPostgresMessage(tx,owner,input)
   if(content)await appendPostgresContent(tx,owner,input.sessionId,input.id,content)
   return message
  })},
  async getMessage(owner:string,id:string):Promise<typeof messages.$inferSelect|undefined>{
   const [row]=await db.select({message:messages}).from(messages).innerJoin(sessions,and(eq(sessions.id,messages.sessionId),eq(sessions.ownerSubject,owner))).where(eq(messages.id,id))
   return row?.message
  },
  async listMessages(owner:string,sessionId:string){
   return (await db.select({message:messages}).from(messages).innerJoin(sessions,and(eq(sessions.id,messages.sessionId),eq(sessions.ownerSubject,owner))).where(eq(messages.sessionId,sessionId)).orderBy(asc(messages.seq),asc(messages.id))).map(row=>row.message)
  },
  appendPart(owner:string,input:PartInput){return db.transaction(tx=>appendPostgresPart(tx,owner,input))},
  updatePart(owner:string,id:string,payload:Record<string,unknown>){return db.transaction(tx=>replacePostgresPart(tx,owner,id,payload))},
  async getPart(owner:string,id:string):Promise<typeof parts.$inferSelect|undefined>{
   const [row]=await db.select({part:parts}).from(parts).innerJoin(sessions,and(eq(sessions.id,parts.sessionId),eq(sessions.ownerSubject,owner))).innerJoin(messages,and(eq(messages.id,parts.messageId),eq(messages.sessionId,parts.sessionId))).where(eq(parts.id,id))
   return row?.part
  },
  async listParts(owner:string,messageId:string){
   return (await db.select({part:parts}).from(parts).innerJoin(sessions,and(eq(sessions.id,parts.sessionId),eq(sessions.ownerSubject,owner))).innerJoin(messages,and(eq(messages.id,parts.messageId),eq(messages.sessionId,parts.sessionId))).where(eq(parts.messageId,messageId)).orderBy(asc(parts.seq),asc(parts.id))).map(row=>row.part)
  },
  async listSessionParts(owner:string,sessionId:string){
   return (await db.select({part:parts}).from(parts).innerJoin(sessions,and(eq(sessions.id,parts.sessionId),eq(sessions.ownerSubject,owner))).innerJoin(messages,and(eq(messages.id,parts.messageId),eq(messages.sessionId,parts.sessionId))).where(eq(parts.sessionId,sessionId)).orderBy(asc(messages.seq),asc(parts.seq),asc(parts.id))).map(row=>row.part)
  },
  setRating(owner:string,messageId:string,rating:-1|0|1){return db.transaction(async tx=>{
   await lockPostgresOwner(tx,owner)
   const [message]=await tx.select({id:messages.id}).from(messages).innerJoin(sessions,and(eq(sessions.id,messages.sessionId),eq(sessions.ownerSubject,owner))).where(eq(messages.id,messageId))
   if(!message)throw new ConversationError(404,'message_not_found')
   if(![-1,0,1].includes(rating))throw Error('invalid_rating')
   if(rating===0)await tx.delete(preferences).where(eq(preferences.messageId,messageId))
   else await tx.insert(preferences).values({messageId,rating}).onConflictDoUpdate({target:preferences.messageId,set:{rating}})
  })},
  async getRating(owner:string,messageId:string):Promise<-1|0|1>{
   const [row]=await db.select({rating:preferences.rating}).from(preferences).innerJoin(messages,eq(messages.id,preferences.messageId)).innerJoin(sessions,and(eq(sessions.id,messages.sessionId),eq(sessions.ownerSubject,owner))).where(eq(preferences.messageId,messageId))
   return (row?.rating??0) as -1|0|1
  },
 }
}
