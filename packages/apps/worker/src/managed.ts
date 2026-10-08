import {validFilesystemPolicy,type FilesystemPolicy} from '@multiterm/rue-sdk/filesystem'
import {existsSync} from 'node:fs'
import {probeAdmissionResources,DEFAULT_AGENT_LIMIT} from './resources.js'
import {join} from 'node:path'
import {z} from 'zod'
import type {RueWorkerLease} from '@multiterm/rue-sdk'
import type {WorkerConfig} from './config.js'
import {atomicState,readPrivate} from './config.js'
import {AgentContainers} from './containers.js'
import {reconcile,type BootIntent,type AgentTarget} from './reconcile.js'
const positive=z.number().int().positive(),uuid=z.string().uuid(),nullable=positive.nullable()
const config=z.object({filesystem:z.custom<FilesystemPolicy>(validFilesystemPolicy).optional(),provider:z.string().max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),model:z.string().min(1).max(128),permission:z.enum(['read-only','coding']),mounts:z.array(z.string().max(32)).max(8),shareToolOutput:z.boolean(),shareThinking:z.boolean(),thinkingLevel:z.enum(['off','minimal','low','medium','high','xhigh']).optional(),autoCompaction:z.boolean().optional(),mcp:z.array(uuid).max(4).optional()}).strict()
const image=z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable().optional()
const agent=z.object({runtimeImage:image,previousRuntimeImage:image,runtimeUpdateState:z.enum(['updating','rolling_back','updated','rolled_back','failed','cancelled']).nullable().optional(),runtimeUpdateVersion:z.string().max(32).nullable().optional(),runtimeStatus:z.object({report:z.unknown(),observedAt:z.number().nullable(),leaseExpiresAt:z.number().nullable()}).nullable().optional(),id:uuid,workerId:uuid,sessionId:z.string().max(128).nullable(),connectionId:z.string().max(64).nullable(),name:z.string().max(60),desired:z.enum(['running','stopped','destroyed']),revision:positive,createdAt:z.number(),config,purgeRequested:z.boolean().default(false),purgedAt:z.number().nullable().default(null),observed:z.enum(['pending','starting','running','stopped','destroyed','purged','failed']),observedRevision:nullable,observedGeneration:nullable,observedAt:z.number().nullable(),error:z.string().max(128).nullable(),busy:z.boolean(),connected:z.boolean(),grantRevision:nullable,grantGeneration:nullable,grantBoot:nullable})
const snapshot=z.object({generation:positive,serverNow:z.number().int(),expiresAt:z.number().int(),desired:z.enum(['active','draining']),agents:z.array(agent).max(64)})
const intentSchema=z.object({generation:positive,revision:positive,boot:positive,attempts:positive,retryAt:z.number().int()}).strict()
/** One serialized reconciler, independently bounded by the acknowledged control lease. */
export class ManagedSupervisor {
 private epoch=0;private activeEpoch=0;private until=0;private wall=0;private lastWall=0;private generation=0;private owner='';private pending=false
 private readonly containers:AgentContainers
 private readonly intents=new Map<string,BootIntent>()
 private lastLaunch=-Infinity
 get rolloutAuthorized(){return this.valid()&&!this.pending}
 get supportsFilesystem(){return this.containers.supportsFilesystem}
 get supportsWorkspaceRoots(){return this.containers.supportsWorkspaceRoots}
 get supportsCodex(){return this.containers.supportsCodex}
 get supportsCompact(){return this.containers.supportsCompact}
 get supportsMcp(){return this.containers.supportsMcp}
 constructor(private readonly cfg:WorkerConfig,private readonly instance:string,image:string,private readonly capacity=DEFAULT_AGENT_LIMIT,mothership=false,workspaceRoots:string[]=[]){
  if(!Number.isSafeInteger(capacity)||capacity<1)throw Error('worker_capacity_invalid')
  this.containers=new AgentContainers(cfg.dockerSocket,cfg.id,cfg.origin,image,()=>this.check(),mothership,workspaceRoots)
 }
 observed(lease:RueWorkerLease,deadline:{mono:number;wall:number}){
  if(this.generation!==lease.generation)this.epoch++
  this.generation=lease.generation;this.owner=lease.worker.ownerSubject;this.until=deadline.mono;this.wall=deadline.wall;this.lastWall=Date.now()
 }
 stop(){this.epoch++;this.until=0;this.wall=0}
 private valid(){const now=Date.now(),valid=performance.now()<this.until&&now<this.wall&&now>=this.lastWall-1000;this.lastWall=now;if(!valid)this.until=0;return valid}
 private check(){if((this.pending&&this.activeEpoch!==this.epoch)||!this.valid())throw Error('worker_authority_lost')}
 private async post(path:string,body:unknown){
  this.check();const epoch=this.epoch
  const response=await fetch(`${this.cfg.origin}/worker-client/${this.cfg.id}/agents/${path}`,{method:'POST',headers:{authorization:`Bearer ${this.cfg.secret}`,'content-type':'application/json'},body:JSON.stringify({instance:this.instance,generation:this.generation,...body as object}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)})
  if(!response.ok){await response.body?.cancel();throw Error('worker_managed_request_failed')}
  const reader=response.body?.getReader();if(!reader)throw Error('worker_managed_response_invalid')
  let size=0;const chunks:Uint8Array[]=[]
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>262144)throw Error('worker_managed_response_invalid');chunks.push(r.value)}}finally{await reader.cancel();reader.releaseLock()}
  this.check();if(epoch!==this.epoch)throw Error('worker_authority_lost')
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('worker_managed_response_invalid')}
 }
 private resourcesAvailable(){
  return probeAdmissionResources(this.cfg.stateDir,this.capacity).blockedBy===null
 }
 async tick(){
  if(this.pending||!this.valid())return false
  this.pending=true;const epoch=this.epoch;this.activeEpoch=epoch
  try{
   const value=snapshot.parse(await this.post('snapshot',{}))
   if(value.generation!==this.generation||value.agents.some(a=>a.workerId!==this.cfg.id)||new Set(value.agents.map(a=>a.id)).size!==value.agents.length)throw Error('worker_managed_response_invalid')
   const visible=new Set(value.agents.map(a=>a.id));for(const id of this.intents.keys())if(!visible.has(id))this.intents.delete(id)
   const valid=()=>epoch===this.epoch&&this.valid()
   const canAdmit=()=>performance.now()-this.lastLaunch>=15000&&this.resourcesAvailable()
   const capacity=this.capacity
   this.containers.configureAgents(value.agents)
   const result=await reconcile(value,{
    canStart:(a,containers)=>canAdmit()&&!containers.some(c=>{
     const other=value.agents.find(other=>other.id===c.agentId)
     return c.running&&c.agentId!==a.id&&other&&!other.connected&&other.observed==='starting'&&other.observedAt!==null&&value.serverNow-other.observedAt<90000
    }),
    authorized:valid,inventory:()=>this.containers.inventory(),prepare:a=>this.containers.prepare(a),remove:c=>this.containers.remove(c),purge:a=>this.containers.purge(a),
    load:id=>{
     if(!this.intents.has(id)){
      const file=join(this.cfg.stateDir,`boot-${id}.json`)
      if(existsSync(file))this.intents.set(id,intentSchema.parse(JSON.parse(readPrivate(file))))
     }
     return this.intents.get(id)
    },
    save:(id,intent)=>{atomicState(this.cfg.stateDir,`boot-${id}.json`,intent);this.intents.set(id,intent)},
    start:async(a,intent)=>{
     // Reserve even on lost acknowledgment; let startup memory settle before another boot.
     this.lastLaunch=performance.now()
     const raw=await this.post(`${a.id}/grant`,{revision:a.revision,boot:intent.boot})
     const g=z.object({id:z.string().length(37).regex(/^term_[A-Za-z0-9_-]{32}$/),token:z.string().length(56).regex(/^rue_terminal_[A-Za-z0-9_-]{43}$/),sessionId:z.string().max(128),piSessionId:uuid,ownerSubject:z.string().max(512),generation:positive,boot:positive,mcp:z.array(z.object({id:uuid,name:z.string().max(60),command:z.string().max(256),args:z.array(z.string().max(256)).max(16),environment:z.record(z.string().max(80),z.string().max(2048))}).strict()).max(4).optional()}).parse(raw)
     if(g.id!==a.connectionId||g.sessionId!==a.sessionId||g.piSessionId!==a.id||g.ownerSubject!==this.owner||g.generation!==intent.generation||g.boot!==intent.boot||!valid())throw Error('worker_grant_invalid')
     await this.containers.start(a,intent,{version:1,origin:this.cfg.origin,agentId:a.id,revision:a.revision,generation:intent.generation,connectionId:g.id,token:g.token,sessionId:g.sessionId,piSessionId:g.piSessionId,ownerSubject:g.ownerSubject,config:a.config,...(g.mcp?.length?{mcp:g.mcp}:{})})
    },
    report:async(a,state,boot,error)=>{
     // Avoid continuous SSE invalidations for unchanged observations.
     if(a.observed===state&&a.observedRevision===a.revision&&a.observedGeneration===this.generation&&a.error===error)return
     await this.post(`${a.id}/report`,{report:{revision:a.revision,boot,state,error}})
    },
   },capacity)
   if(value.desired==='active'&&this.supportsCompact&&valid()){
    const commands=z.object({commands:z.array(z.object({id:uuid,agentId:uuid,revision:positive,generation:positive,boot:positive})).max(64)}).parse(await this.post('compactions',{})).commands
    if(commands.length){
     const inventory=await this.containers.inventory()
     for(const command of commands){
      const agent=value.agents.find(a=>a.id===command.agentId&&a.desired==='running'&&a.revision===command.revision&&a.grantRevision===command.revision&&a.grantGeneration===command.generation&&a.grantBoot===command.boot)
      const containers=inventory.filter(c=>c.agentId===command.agentId)
      if(agent&&!agent.busy&&valid()&&command.generation===this.generation&&containers.length===1&&containers[0]!.running&&containers[0]!.revision===command.revision&&containers[0]!.generation===command.generation&&containers[0]!.boot===command.boot)await this.post(`compactions/${command.id}/assign`,{})
     }
    }
   }
   return value.desired==='active'&&result.accepting&&canAdmit()
  }finally{this.pending=false}
 }
}
