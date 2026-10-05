import type {RueManagedAgent} from '@multiterm/rue-sdk'

export interface AgentTarget extends RueManagedAgent {
 busy:boolean; connected:boolean; grantRevision:number|null; grantGeneration:number|null; grantBoot:number|null
}
export interface RuntimeContainer {id:string;agentId:string;generation:number;revision:number;boot:number;running:boolean}
export interface BootIntent {generation:number;revision:number;boot:number;attempts:number;retryAt:number}
export interface ReconcileSnapshot {generation:number;desired:'active'|'draining';agents:AgentTarget[]}
export interface ReconcilePorts {
 /** Must reject foreign names, images, labels, mounts and privileges, not merely trust a label. */
 inventory():Promise<RuntimeContainer[]>
 /** Local kernel lock and server-confirmed authority are independent requirements. */
 authorized():boolean
 load(agentId:string):BootIntent|undefined
 save(agentId:string,intent:BootIntent):void
 /** Backpressure must not stop a healthy old revision or consume boot attempts. */
 canStart?(agent:AgentTarget,containers:RuntimeContainer[]):boolean
 prepare?(agent:AgentTarget):Promise<void>
 remove(container:RuntimeContainer):Promise<void>
 start(agent:AgentTarget,intent:BootIntent):Promise<void>
 purge(agent:AgentTarget):Promise<void>
 report(agent:AgentTarget,state:'starting'|'running'|'stopped'|'destroyed'|'purged'|'failed',boot:number,error:null|'capacity_unavailable'|'mount_unavailable'|'runtime_failed'):Promise<void>
}
/** Serialized reconciliation. No prompt submission, volume deletion, or automatic replay. */
export async function reconcile(snapshot:ReconcileSnapshot,ports:ReconcilePorts,capacity:number,now=Date.now()){
 const check=()=>{if(!ports.authorized())throw Error('worker_authority_lost')}
 check()
 const containers=await ports.inventory();check()
 // A delayed supervisor may not stop a newer supervisor's resources.
 if(containers.some(c=>c.generation>snapshot.generation))throw Error('worker_generation_conflict')
 const byId=new Map(snapshot.agents.map(a=>[a.id,a]))
 // Unknown resources require operator review; absence is not purge authorization.
 if(containers.some(c=>!byId.has(c.agentId)))throw Error('worker_ownership_conflict')
 let used=containers.filter(c=>c.running).length
 for(const agent of snapshot.agents){
  check()
  const own=containers.filter(c=>c.agentId===agent.id)
  const current=own.find(c=>c.generation===snapshot.generation&&c.revision===agent.revision&&c.boot===agent.grantBoot)
  const report=async(state:Parameters<ReconcilePorts['report']>[1],boot:number,error:Parameters<ReconcilePorts['report']>[3]=null)=>{check();await ports.report(agent,state,boot,error);check()}
  if(agent.desired!=='running'){
   for(const c of own){check();await ports.remove(c);check();if(c.running)used--}
   if(agent.purgeRequested&&!agent.purgedAt){
    check();await ports.purge(agent);check();await report('purged',agent.grantBoot??1)
   }else await report(agent.desired,agent.grantBoot??1)
   continue
  }
  const saved=ports.load(agent.id)
  const startupExpired=Boolean(current?.running&&!agent.connected&&!agent.busy&&saved?.generation===snapshot.generation&&saved.revision===agent.revision&&saved.boot===current.boot&&now>saved.retryAt+60000)
  // Reload drains both accepted work and the relay outbox before replacement.
  if(agent.busy && (!current?.running || own.length!==1))continue
  if(!current?.running||startupExpired){
   if(ports.canStart&&!ports.canStart(agent,containers))continue
   try{check();await ports.prepare?.(agent);check()}
   catch(error){check();if(error instanceof Error&&error.message==='worker_authority_lost')throw error;await report('failed',agent.grantBoot??1,'runtime_failed');continue}
  }
  for(const c of own){
   if(c===current&&c.running&&!startupExpired)continue
   check();await ports.remove(c);check();if(c.running)used--
  }
  if(current?.running&&!startupExpired){await report(agent.connected?'running':'starting',current.boot);continue}
  if(snapshot.desired==='draining')continue
  if(agent.config.mounts.length){await report('failed',agent.grantBoot??1,'mount_unavailable');continue}
  if(used>=capacity){await report('failed',agent.grantBoot??1,'capacity_unavailable');continue}
  let intent=saved
  const sameEpoch=intent?.generation===snapshot.generation&&intent.revision===agent.revision
  if(!sameEpoch)intent=undefined
  if(intent&&intent.attempts>=3){await report('failed',agent.grantBoot??intent.boot,'runtime_failed');continue}
  if(intent&&intent.retryAt>now)continue
  // Preflight/removal involve I/O: sample headroom again before reserving a boot.
  if(ports.canStart&&!ports.canStart(agent,containers))continue
  // A failed/exited process needs a NEW boot; a lost create/grant response uses
  // the saved pending boot until inventory proves a process actually existed.
  const oldGrant=agent.grantGeneration===snapshot.generation&&agent.grantRevision===agent.revision?(agent.grantBoot??1):0
  const exited=own.some(c=>(!c.running||(c===current&&startupExpired))&&c.boot===oldGrant&&c.generation===snapshot.generation&&c.revision===agent.revision)
  const boot=intent&&!exited?Math.max(intent.boot,oldGrant):oldGrant+1
  const next:BootIntent={generation:snapshot.generation,revision:agent.revision,boot,attempts:(intent?.attempts??0)+1,retryAt:now+Math.min(60000,10000*2**(intent?.attempts??0))}
  check();ports.save(agent.id,next) // durable before any grant/create side effect
  // Reserve before the call: a lost acknowledgement may still have started it.
  used++
  try{check();await ports.start(agent,next);check();await report('starting',boot)}
  catch(error){check();if(error instanceof Error&&error.message==='worker_authority_lost')throw error;await report('failed',oldGrant||boot,'runtime_failed')}
 }
 return {accepting:used<capacity}
}
