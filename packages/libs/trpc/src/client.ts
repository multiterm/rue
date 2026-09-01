import { QueryClient } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import superjson from 'superjson'
import type { AppRouter } from './index.js'
export type { AppRouter } from './index.js'
export function createRueQueryClient(){return new QueryClient({defaultOptions:{queries:{staleTime:30_000,gcTime:300_000,retry:1,refetchOnWindowFocus:false}}})}
export function createRueTrpcClient(options:{baseUrl:string;token?:()=>string|undefined|Promise<string|undefined>;fetch?:typeof globalThis.fetch}){return createTRPCClient<AppRouter>({links:[httpBatchLink({transformer:superjson,url:`${options.baseUrl.replace(/\/$/,'')}/trpc`,fetch:options.fetch,async headers(){const token=await options.token?.();return token?{authorization:`Bearer ${token}`}:{}}})]})}
