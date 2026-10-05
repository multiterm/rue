import { QueryClient } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import type { AppRouter } from './index.js'
import type {SessionRecord,SessionCursor} from '@multiterm/rue-db/session-repository'
export type { AppRouter } from './index.js'
export async function listRueSessions(client:ReturnType<typeof createRueTrpcClient>,signal?:AbortSignal):Promise<SessionRecord[]>{
 const rows=new Map<string,SessionRecord>();let cursor:SessionCursor|undefined
 do{
  const page=await client.sessionsPage.query({limit:100,cursor},{signal})
  for(const item of page.items)rows.set(item.id,item)
  if(page.nextCursor&&cursor&&page.nextCursor.id===cursor.id&&page.nextCursor.updatedAt===cursor.updatedAt)throw Error('Session pagination did not advance')
  cursor=page.nextCursor??undefined
 }while(cursor)
 return [...rows.values()]
}
export function createRueQueryClient(){return new QueryClient({defaultOptions:{queries:{staleTime:30_000,gcTime:300_000,retry:1,refetchOnWindowFocus:false}}})}
export function createRueTrpcClient(options:{baseUrl:string;token?:()=>string|undefined|Promise<string|undefined>;fetch?:typeof globalThis.fetch}){return createTRPCClient<AppRouter>({links:[httpBatchLink({transformer:superjson,url:`${options.baseUrl.replace(/\/$/,'')}/trpc`,fetch:options.fetch,async headers(){const token=await options.token?.();return token?{authorization:`Bearer ${token}`}:{}}})]})}
