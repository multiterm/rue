import {z} from 'zod'
import type {RueRuntimeRollout} from '@multiterm/rue-sdk'
import type {RuntimePolicy} from './policy.js'
import {configureRuntime} from './policy.js'
import type {WorkerConfig} from './config.js'
import {engineRequest} from './engine.js'
const digest=z.string().regex(/^sha256:[a-f0-9]{64}$/)
const jobSchema=z.object({id:z.string().uuid(),workerId:z.string().uuid(),requestId:z.string().uuid(),phase:z.enum(['preflight','draining','stopping','installing','verifying','rollback_stopping','rollback_installing','rollback_verifying','succeeded','failed','uncertain']),image:digest,previousImage:digest,createdAt:z.number(),updatedAt:z.number(),expiresAt:z.number(),error:z.string().nullable()}).strict()
export interface RolloutPorts {
 check():void
 inspect(image:string):Promise<void>
 install(image:string):Promise<void>
 report(jobId:string,report:{action:'ready'|'installed'|'rejected';image?:string}):Promise<void>
}
/** Only verified, already-local immutable images. No remote shell, builds, pulls or host paths. */
export async function executeRuntimeRollout(job:RueRuntimeRollout,policy:RuntimePolicy,ports:RolloutPorts){
 ports.check()
 if(!policy.allowRuntimeRollouts)return
 if(job.phase==='preflight'){
  if(policy.image!==job.previousImage){await ports.report(job.id,{action:'rejected'});return}
  try{await ports.inspect(job.image)}catch{ports.check();await ports.report(job.id,{action:'rejected'});return}
  ports.check();await ports.report(job.id,{action:'ready',image:job.image});return
 }
 if(job.phase!=='installing'&&job.phase!=='rollback_installing')return
 const image=job.phase==='installing'?job.image:job.previousImage
 if(![job.image,job.previousImage].includes(policy.image)){await ports.report(job.id,{action:'rejected'});return}
 try{await ports.inspect(image);ports.check();await ports.install(image)}catch{ports.check();await ports.report(job.id,{action:'rejected'});return}
 ports.check();await ports.report(job.id,{action:'installed',image})
}
export async function runtimeRolloutTick(cfg:WorkerConfig,instance:string,generation:number,policy:RuntimePolicy,check:()=>void,changed:(policy:RuntimePolicy)=>void,signal:AbortSignal){
 if(!policy.allowRuntimeRollouts)return
 const post=async(path:string,extra:Record<string,unknown>={})=>{
  check()
  const response=await fetch(`${cfg.origin}/worker-client/${cfg.id}/runtime-rollouts/${path}`,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),headers:{authorization:`Bearer ${cfg.secret}`,'content-type':'application/json'},body:JSON.stringify({instance,generation,...extra})})
  if(!response.ok){await response.body?.cancel();throw Error('worker_rollout_request_failed')}
  const reader=response.body?.getReader();if(!reader)throw Error('worker_rollout_response_invalid')
  const chunks:Uint8Array[]=[];let size=0
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32768)throw Error('worker_rollout_response_invalid');check();chunks.push(part.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  check();return JSON.parse(Buffer.concat(chunks).toString('utf8'))
 }
 const value=await post('poll');if(value.job===null)return
 const job=jobSchema.parse(value.job);if(job.workerId!==cfg.id)throw Error('worker_rollout_binding_invalid')
 await executeRuntimeRollout(job,policy,{
  check,
  inspect:async image=>{const metadata=await engineRequest(cfg.dockerSocket,'GET',`/images/${image}/json`,undefined,signal) as any;check();if(metadata?.Id!==image||metadata.Config?.Labels?.['io.rue.agent-runtime']!=='1'||(policy.mothership&&!['2','3'].includes(metadata.Config?.Labels?.['io.rue.filesystem']))||(policy.workspaceRoots?.length&&metadata.Config?.Labels?.['io.rue.filesystem']!=='3'))throw Error('worker_runtime_image_invalid')},
  install:async image=>{
   // Re-running after a lost ACK is safe: configureRuntime refuses any remaining container.
   await configureRuntime(cfg,image,policy.capacity,policy.mothership===true,true,check,policy.workspaceRoots)
   if(image!==policy.image)changed({...policy,image})
  },
  report:async(id,report)=>{await post(`${id}/report`,{report})},
 })
}
