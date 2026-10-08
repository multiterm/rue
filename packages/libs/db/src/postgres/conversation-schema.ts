import {sql} from 'drizzle-orm'
import {bigint,check,index,integer,json,pgTable,text} from 'drizzle-orm/pg-core'
/** Preserve Rue's prefixed IDs and millisecond timestamps during migration.
 * JSON (not JSONB) preserves serialized conversation content, including escaped
 * NUL/unpaired-surrogate text that SQLite accepts and PostgreSQL JSONB rejects. */
export const sessions=pgTable('sessions',{
 id:text('id').primaryKey(),title:text('title').notNull().default(''),agent:text('agent'),provider:text('provider'),model:text('model'),directory:text('directory'),
 scopes:json('scopes').$type<string[]>().notNull().default([]),parentId:text('parent_id'),ownerSubject:text('owner_subject').notNull(),
 createdAt:bigint('created_at',{mode:'number'}).notNull(),updatedAt:bigint('updated_at',{mode:'number'}).notNull(),meta:json('meta').$type<Record<string,unknown>>().notNull().default({}),
},table=>[index('idx_sessions_owner_updated').on(table.ownerSubject,table.updatedAt,table.id),index('idx_sessions_parent').on(table.parentId)])
export const messages=pgTable('messages',{
 id:text('id').primaryKey(),sessionId:text('session_id').notNull().references(()=>sessions.id,{onDelete:'cascade'}),role:text('role',{enum:['user','assistant','system']}).notNull(),
 time:bigint('time',{mode:'number'}).notNull(),provider:text('provider'),model:text('model'),agent:text('agent'),meta:json('meta').$type<Record<string,unknown>>().notNull().default({}),seq:integer('seq').notNull(),
},table=>[index('idx_messages_session').on(table.sessionId,table.seq),check('messages_role_check',sql`${table.role} IN ('user','assistant','system')`)])
export const parts=pgTable('parts',{
 id:text('id').primaryKey(),sessionId:text('session_id').notNull().references(()=>sessions.id,{onDelete:'cascade'}),messageId:text('message_id').notNull().references(()=>messages.id,{onDelete:'cascade'}),
 type:text('type').notNull(),seq:integer('seq').notNull(),payload:json('payload').$type<Record<string,unknown>>().notNull(),
},table=>[index('idx_parts_message').on(table.messageId,table.seq),index('idx_parts_session_seq').on(table.sessionId,table.seq)])
export const conversationSchema={sessions,messages,parts}
