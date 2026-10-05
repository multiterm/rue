import {randomUUID} from 'node:crypto'
import {and,eq,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {sessions,messages,parts} from './schema.js'
import {lockPostgresOwner} from './owner-lock.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
import {AttachmentError,MAX_ATTACHMENT_STORAGE_BYTES,ATTACHMENT_STORAGE_FULL,type MessageContent} from '../attachment-types.js'
export type {MessageContent} from '../attachment-types.js'
export async function lockPostgresSession(tx:Tx,owner:string,id:string){
 await lockPostgresOwner(tx,owner)
 const [session]=await tx.select().from(sessions).where(and(eq(sessions.id,id),eq(sessions.ownerSubject,owner))).for('update')
 if(!session)throw Error('conversation_not_found')
 return session
}
/** All allocations and parent updates use the caller's transaction. No out-of-band events. */
export async function appendPostgresMessage(tx:Tx,owner:string,input:{id:string;sessionId:string;role:'user'|'assistant'|'system';time?:number;provider?:string|null;model?:string|null;agent?:string|null;meta?:Record<string,unknown>}){
 await lockPostgresSession(tx,owner,input.sessionId)
 const [{next}]=await tx.select({next:sql<number>`COALESCE(MAX(${messages.seq}),-1)+1`}).from(messages).where(eq(messages.sessionId,input.sessionId))
 const time=input.time??Date.now()
 const [row]=await tx.insert(messages).values({...input,time,seq:next!,meta:input.meta??{}}).returning()
 await tx.update(sessions).set({updatedAt:time}).where(eq(sessions.id,input.sessionId))
 return row!
}
export async function appendPostgresPart(tx:Tx,owner:string,input:{id:string;sessionId:string;messageId:string;type:string;payload:Record<string,unknown>}){
 await lockPostgresSession(tx,owner,input.sessionId)
 const [message]=await tx.select({id:messages.id}).from(messages).where(and(eq(messages.id,input.messageId),eq(messages.sessionId,input.sessionId)))
 if(!message)throw Error('message_not_found')
 const [{next}]=await tx.select({next:sql<number>`COALESCE(MAX(${parts.seq}),-1)+1`}).from(parts).where(eq(parts.messageId,input.messageId))
 const [row]=await tx.insert(parts).values({...input,seq:next!}).returning();return row!
}
export async function replacePostgresPart(tx:Tx,owner:string,id:string,payload:Record<string,unknown>){
 await lockPostgresOwner(tx,owner)
 const [part]=await tx.select({sessionId:parts.sessionId}).from(parts).innerJoin(sessions,and(eq(sessions.id,parts.sessionId),eq(sessions.ownerSubject,owner))).where(eq(parts.id,id))
 if(!part)return
 const [row]=await tx.update(parts).set({payload}).where(and(eq(parts.id,id),eq(parts.sessionId,part.sessionId))).returning();return row
}
/** Content has already passed the API's byte/MIME validation. Check account quota
 * under the owner lock so concurrent messages cannot exceed it. */
export async function checkPostgresAttachmentBudget(tx:Tx,owner:string,content?:MessageContent[]){
 if(!content)return
 await lockPostgresOwner(tx,owner)
 const [used]=await tx.execute<{size:number}>(sql`SELECT COALESCE(SUM(length(p.payload::text)),0)::bigint AS size FROM public.parts p JOIN public.sessions s ON s.id=p.session_id WHERE p.type='file' AND s.owner_subject=${owner}`)
 if(Number(used!.size)+JSON.stringify(content).length>MAX_ATTACHMENT_STORAGE_BYTES)throw new AttachmentError(ATTACHMENT_STORAGE_FULL)
}
export async function appendPostgresContent(tx:Tx,owner:string,sessionId:string,messageId:string,content:MessageContent[]){
 for(const part of content){const {type,...payload}=part;await appendPostgresPart(tx,owner,{id:`part_${randomUUID()}`,sessionId,messageId,type,payload})}
}
