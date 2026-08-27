import { initTRPC } from '@trpc/server'
import { desc, eq } from 'drizzle-orm'
import superjson from 'superjson'
import type { RueDatabase } from '@multiterm/rue-db'
import { sessions } from '@multiterm/rue-db/schema'
export interface RueTrpcContext { db: RueDatabase; principalSubject: string }
const t=initTRPC.context<RueTrpcContext>().create({transformer:superjson})
export const appRouter=t.router({
  health:t.procedure.query(()=>({status:'ok' as const,service:'rue'})),
  sessions:t.procedure.query(({ctx})=>ctx.db.select().from(sessions).where(eq(sessions.ownerSubject,ctx.principalSubject)).orderBy(desc(sessions.updatedAt)).limit(100)),
})
export type AppRouter=typeof appRouter
