import {configuredPushTransport,startPushDispatcher} from './web-push.js'
import {serve,type ServerType} from '@hono/node-server'
import type {Config} from '../config/index.js'
import {createApp} from './app.js'
import {SocketRouter} from './socket-router.js'
import {installWorkerSocket} from './worker-socket.js'
import {installTerminalSocket} from './terminal-socket.js'
import type {Server} from 'node:http'
import {configuredTenancyVerifier} from './tenancy-verifier.js'
import {ProjectAuthority,fenceProjectAuthorityOnBoot} from './project-authority.js'
import type {ServerContext} from './context.js'
import {sessionServices} from './session-services.js'
import {openServerContext} from './open-context.js'
import {encryptionKey} from '../storage/agent-settings.js'
export interface ListenOptions {
 config:Config
 /** SQLite compatibility/test override; refused with the PostgreSQL backend. */
 dbPath?:string
 /** Caller-owned context; the caller remains responsible for its database. */
 ctx?:ServerContext
 log?:boolean
}
export interface RueServer {url:string;hostname:string;port:number;ctx:ServerContext;close():Promise<void>}
/** Startup selects one backend before binding. Shutdown closes owned pools after
 * stopping background dispatch and transports; failure never falls back to SQLite. */
export async function listen(opts:ListenOptions):Promise<RueServer>{
 const ctx=opts.ctx??await openServerContext(opts.config,opts.dbPath),owned=!opts.ctx
 let server:ServerType|undefined,router:SocketRouter|undefined,disposeTerminal:(()=>void)|undefined,disposeWorker:(()=>void)|undefined,stopPush:(()=>Promise<void>)|undefined,closing:Promise<void>|undefined
 const close=()=>closing??=(async()=>{
  ctx.stopping=true
  disposeWorker?.();disposeTerminal?.();router?.close()
  try{
   await stopPush?.()
   if(server?.listening){
    const http=server as Server
    await new Promise<void>((resolve,reject)=>{
     const deadline=setTimeout(()=>http.closeAllConnections(),5000);deadline.unref()
     http.close(error=>{clearTimeout(deadline);error?reject(error):resolve()});http.closeIdleConnections()
    })
   }
  }finally{if(owned)await closeContext(ctx)}
 })()
 try{
  const store=sessionServices(ctx)
  await fenceProjectAuthorityOnBoot(store.execution.projects)
  if(!ctx.projectAuthority){const verifier=configuredTenancyVerifier();if(verifier)ctx.projectAuthority=new ProjectAuthority(store.execution.projects,verifier)}
  if(!ctx.pushTransport)ctx.pushTransport=configuredPushTransport(ctx.credentialKey??(()=>ctx.db?encryptionKey(ctx.db):undefined))
  const terminalPairing=process.env.RUE_TERMINAL_BRIDGE==='true'||['development','develop'].includes(process.env.SANDBLOCKS_RUNTIME??'')
  const managedWorkers=process.env.RUE_MANAGED_WORKERS==='true'&&ctx.config.keyname.enabled
  const app=createApp({ctx,log:opts.log,terminalPairing,managedWorkers,managedAgents:process.env.RUE_MANAGED_AGENTS==='true'})
  const assertAvailable=()=>{if(ctx.storage?.available===false)throw Error('rue_storage_unavailable')}
  assertAvailable()
  const {hostname,port}=opts.config.server
  server=await new Promise<ServerType>((resolve,reject)=>{
   const s=serve({fetch:app.fetch,hostname,port},()=>{s.removeListener('error',reject);resolve(s)})
   s.once('error',reject)
  })
  ctx.terminalSocketEnabled=terminalPairing&&ctx.config.keyname.enabled
  router=new SocketRouter(server as Server)
  disposeTerminal=ctx.terminalSocketEnabled?installTerminalSocket(server as Server,ctx,request=>app.fetch(request),router):undefined
  disposeWorker=managedWorkers?installWorkerSocket(router,ctx):undefined
  stopPush=ctx.pushTransport?startPushDispatcher(store.notifications,ctx.pushTransport):undefined
  assertAvailable()
  void ctx.storage?.failure?.then(()=>close()).catch(()=>{console.error('rue_storage_shutdown_failed')})
  const address=server.address(),resolvedPort=typeof address==='object'&&address!==null?address.port:port
  return {url:`http://${hostname}:${resolvedPort}`,hostname,port:resolvedPort,ctx,close}
 }catch(error){await close();throw error}
}
/** Idempotent for owned contexts; await this when disposing an injected context. */
export async function closeContext(ctx:ServerContext):Promise<void>{
 if(ctx.storage)await ctx.storage.close()
 else if(ctx.db?.open)ctx.db.close()
}
