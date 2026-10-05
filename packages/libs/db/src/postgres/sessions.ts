import {and,desc,eq,lt,or} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {sessions} from './schema.js'
import {sessionPage,sessionPageLimit,type SessionRepository} from '../session-repository.js'
export function createPostgresSessionRepository(db:RuePostgresDatabase):SessionRepository{
 return {
  async list(owner,input={}){
   const limit=sessionPageLimit(owner,input),cursor=input.cursor
   const rows=await db.select().from(sessions).where(and(eq(sessions.ownerSubject,owner),cursor?or(lt(sessions.updatedAt,cursor.updatedAt),and(eq(sessions.updatedAt,cursor.updatedAt),lt(sessions.id,cursor.id))):undefined)).orderBy(desc(sessions.updatedAt),desc(sessions.id)).limit(limit+1)
   return sessionPage(rows,limit)
  },
  async get(owner,id){sessionPageLimit(owner);return (await db.select().from(sessions).where(and(eq(sessions.ownerSubject,owner),eq(sessions.id,id))).limit(1))[0]},
 }
}
