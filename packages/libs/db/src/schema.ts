import { index, integer, sqliteTable, text, unique, primaryKey } from 'drizzle-orm/sqlite-core'
export const sessions = sqliteTable('sessions',{id:text('id').primaryKey(),title:text('title').notNull().default(''),agent:text('agent'),provider:text('provider'),model:text('model'),directory:text('directory'),scopes:text('scopes',{mode:'json'}).$type<string[]>().notNull().default([]),parentId:text('parent_id'),ownerSubject:text('owner_subject').notNull().default('local'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),meta:text('meta',{mode:'json'}).$type<Record<string,unknown>>().notNull().default({})},table=>[index('idx_sessions_updated').on(table.updatedAt),index('idx_sessions_parent').on(table.parentId),index('idx_sessions_owner_updated').on(table.ownerSubject,table.updatedAt)])
export const messages = sqliteTable('messages',{id:text('id').primaryKey(),sessionId:text('session_id').notNull().references(()=>sessions.id,{onDelete:'cascade'}),role:text('role',{enum:['user','assistant','system']}).notNull(),time:integer('time').notNull(),provider:text('provider'),model:text('model'),agent:text('agent'),meta:text('meta',{mode:'json'}).$type<Record<string,unknown>>().notNull().default({}),seq:integer('seq').notNull()})
export const parts = sqliteTable('parts',{id:text('id').primaryKey(),sessionId:text('session_id').notNull().references(()=>sessions.id,{onDelete:'cascade'}),messageId:text('message_id').notNull().references(()=>messages.id,{onDelete:'cascade'}),type:text('type').notNull(),seq:integer('seq').notNull(),payload:text('payload',{mode:'json'}).$type<Record<string,unknown>>().notNull()})
export const workers = sqliteTable('workers', {
  id: text('id').primaryKey(), ownerSubject: text('owner_subject').notNull(), name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(), enrollmentRequestId: text('enrollment_request_id').notNull(),
  desired: text('desired', { enum: ['active','draining'] }).notNull().default('active'),
  revision: integer('revision').notNull().default(0), generation: integer('generation').notNull().default(0),
  instanceId: text('instance_id'), leaseExpiresAt: integer('lease_expires_at'), lastSeenAt: integer('last_seen_at'),
  health: text('health', { mode: 'json' }).$type<Record<string, unknown>>(), revokedAt: integer('revoked_at'), createdAt: integer('created_at').notNull(),
}, table => [index('workers_owner').on(table.ownerSubject), unique().on(table.ownerSubject, table.enrollmentRequestId)])
export const workerAudit = sqliteTable('worker_audit', {
  id: text('id').primaryKey(), workerId: text('worker_id').notNull().references(() => workers.id),
  action: text('action').notNull(), revision: integer('revision').notNull(), createdAt: integer('created_at').notNull(),
})
export const providerKeys = sqliteTable('provider_keys', {
  ownerSubject: text('owner_subject').notNull(), provider: text('provider').notNull(), encryptedKey: text('encrypted_key'), revision: integer('revision').notNull(),
}, table => [primaryKey({ columns: [table.ownerSubject, table.provider] })])
export const providerKeyGrants = sqliteTable('provider_key_grants', {
  ownerSubject: text('owner_subject').notNull(), provider: text('provider').notNull(), targetType: text('target_type', { enum: ['terminal','worker'] }).notNull(), targetId: text('target_id').notNull(),
}, table => [primaryKey({ columns: [table.ownerSubject, table.provider, table.targetType, table.targetId] })])
export const providerKeyAudit = sqliteTable('provider_key_audit', {
  id: text('id').primaryKey(), ownerSubject: text('owner_subject').notNull(), provider: text('provider').notNull(), action: text('action').notNull(), targetType: text('target_type'), targetId: text('target_id'), createdAt: integer('created_at').notNull(),
})
export const schema={sessions,messages,parts,workers,workerAudit,providerKeys,providerKeyGrants,providerKeyAudit}
