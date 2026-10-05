import {initTRPC,TRPCError} from '@trpc/server'
import {z} from 'zod'
import superjson from 'superjson'
import {credentialLoginSchema,mfaSchema} from './contracts.js'
export {credentialLoginSchema,mfaSchema} from './contracts.js'
import {KeynameClient} from '@keyname/sdk'
import {KeynameServerClient} from '@keyname/sdk/server'
import type {SessionRepository} from '@multiterm/rue-db/session-repository'
export interface RueTrpcContext{sessions:SessionRepository;principalSubject:string;keyname?:{apiUrl:string;clientId?:string;clientSecret?:string}}
const t=initTRPC.context<RueTrpcContext>().create({transformer:superjson})
const authenticated=t.procedure.use(({ctx,next})=>{if(!ctx.principalSubject?.trim()||ctx.principalSubject==='anonymous')throw new TRPCError({code:'UNAUTHORIZED'});return next()})
const sessionPageInput=z.object({limit:z.number().int().min(1).max(100).optional(),cursor:z.object({updatedAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),id:z.string().min(1).max(128)}).optional()}).default({})
const keynameConfig=(ctx:RueTrpcContext)=>{if(!ctx.keyname?.clientId)throw new TRPCError({code:'PRECONDITION_FAILED',message:'Keyname password login is not configured. Continue with Keyname instead.'});return ctx.keyname as {apiUrl:string;clientId:string;clientSecret?:string}}
export const appRouter=t.router({
  health:t.procedure.query(()=>({status:'ok' as const,service:'rue'})),
  sessions:authenticated.query(async({ctx})=>(await ctx.sessions.list(ctx.principalSubject)).items),
  sessionsPage:authenticated.input(sessionPageInput).query(({ctx,input})=>ctx.sessions.list(ctx.principalSubject,input)),
  session:authenticated.input(z.object({id:z.string().min(1).max(128)})).query(async({ctx,input})=>{const session=await ctx.sessions.get(ctx.principalSubject,input.id);if(!session)throw new TRPCError({code:'NOT_FOUND'});return session}),
  auth:t.router({
    login:t.procedure.input(credentialLoginSchema).mutation(async({ctx,input})=>{try{const config=keynameConfig(ctx);if(config.clientSecret){const result=await new KeynameServerClient({url:config.apiUrl,clientId:config.clientId,clientSecret:config.clientSecret}).login(input);if('mfaRequired'in result)return result;return{accessToken:result.token,userEmail:result.record.userEmail,subject:result.record.subject}}const result=await new KeynameClient(config.clientId,{url:config.apiUrl,credentials:'omit'}).login({email:input.identifier,password:input.password});if('mfaRequired'in result)return result;return{accessToken:result.token,userEmail:result.user.email,subject:'keyname-user'}}catch(error){if(error instanceof TRPCError)throw error;throw new TRPCError({code:'UNAUTHORIZED',message:error instanceof Error?error.message:'Invalid username or password.'})}}),
    verifyMfa:t.procedure.input(mfaSchema).mutation(async({ctx,input})=>{try{const config=keynameConfig(ctx);if(config.clientSecret){const result=await new KeynameServerClient({url:config.apiUrl,clientId:config.clientId,clientSecret:config.clientSecret}).verifyMfa(input);return{accessToken:result.token,userEmail:result.record.userEmail,subject:result.record.subject}}const result=await new KeynameClient(config.clientId,{url:config.apiUrl,credentials:'omit'}).verifyMfa(input);return{accessToken:result.token,userEmail:result.user.email,subject:'keyname-user'}}catch(error){throw new TRPCError({code:'UNAUTHORIZED',message:error instanceof Error?error.message:'Invalid authentication code.'})}}),
  }),
})
export type AppRouter=typeof appRouter
