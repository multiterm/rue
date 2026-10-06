import type {Database} from 'better-sqlite3'
import type {z} from 'zod'
import {randomUUID} from 'node:crypto'
import {requiresWorkspaceRoots,type RueWorker} from '@multiterm/rue-sdk'
import {createPostgresWorkerRepository,createPostgresProjectRepository,createPostgresManagedAgentRepository,createPostgresMcpRepository,createPostgresCompactionRepository,createPostgresRolloutRepository,createPostgresRuntimeControlRepository,createPostgresTerminalPairingRepository,createPostgresTerminalRelayRepository,type RuePostgresDatabase,type ProjectAuthorityRepository} from '@multiterm/rue-db/postgres'
import * as workers from '../storage/workers.js'
import * as managed from '../storage/managed-agents.js'
import * as mcp from '../storage/mcp.js'
import * as compaction from '../storage/managed-compaction.js'
import * as rollouts from '../storage/runtime-rollouts.js'
import * as control from '../storage/runtime-control.js'
import {authenticateTerminalConnection} from '../storage/terminal-pairing.js'
import {validateRelaySocket} from '../storage/terminal-relay.js'
import {createSqliteProjectAuthorityRepository} from '../storage/sqlite-project-authority.js'
import {createProjectBinding} from '../storage/projects.js'
import {agentStatusSchema} from '../storage/agent-status.js'
import {postgresRelayOptions,storedHealth} from '../storage/relay-health.js'
import {createCredentialCodec} from '../storage/credential-codec.js'
type WorkerStore=ReturnType<typeof createPostgresWorkerRepository<z.infer<typeof workers.workerHealthSchema>>>
type ManagedStore=ReturnType<typeof createPostgresManagedAgentRepository<z.infer<typeof managed.managedConfigSchema>,z.infer<typeof agentStatusSchema>>>
type AffectedAgent=Pick<Awaited<ReturnType<ManagedStore['get']>>,'id'|'workerId'|'sessionId'>
type AsyncStore<F>=F extends (db:Database,...args:infer A)=>infer R?(...args:A)=>Promise<Awaited<R>>:never
export interface ExecutionServices {
 projects:ProjectAuthorityRepository&Pick<ReturnType<typeof createPostgresProjectRepository>,'create'>
 workers:{
  list:AsyncStore<typeof workers.listWorkers>;create:AsyncStore<typeof workers.createWorker>;change:AsyncStore<typeof workers.changeWorker>
  projectBinding:AsyncStore<typeof workers.workerProjectBinding>;connect:AsyncStore<typeof workers.connectWorker>;heartbeat:AsyncStore<typeof workers.heartbeatWorker>
  validate(...args:Parameters<WorkerStore['validate']>):Promise<RueWorker>
 }
 managed:Pick<ManagedStore,'get'|'list'|'operations'|'create'|'change'|'report'>&{snapshot:AsyncStore<typeof managed.managedSnapshot>;grant:AsyncStore<typeof managed.managedGrant>}
 mcp:Pick<ReturnType<typeof createPostgresMcpRepository<AffectedAgent>>,'list'|'create'|'remove'>
 compaction:ReturnType<typeof createPostgresCompactionRepository>
 rollouts:Pick<ReturnType<typeof createPostgresRolloutRepository>,'request'|'cancel'|'get'|'list'|'poll'|'report'|'resolve'>
 control:Pick<ReturnType<typeof createPostgresRuntimeControlRepository>,'get'|'update'|'describe'|'requestRollout'|'rollout'>
 terminal:Pick<ReturnType<typeof createPostgresTerminalPairingRepository>,'authenticate'>
}
export function createPostgresExecutionServices(db:RuePostgresDatabase,encryptionKey:()=>Buffer|undefined):ExecutionServices {
 const codec=createCredentialCodec(encryptionKey),terminal=createPostgresTerminalPairingRepository(db),worker=createPostgresWorkerRepository(db,value=>workers.workerHealthSchema.parse(value)),relay=createPostgresTerminalRelayRepository(db,postgresRelayOptions)
 let agents:ManagedStore
 const profiles=createPostgresMcpRepository<AffectedAgent>(db,{codec,parseProfile:value=>mcp.mcpProfileSchema.parse(value),stopAgent:async(tx,owner,id,revision,now)=>(await agents.changeInTransaction(tx,owner,id,{requestId:randomUUID(),expectedRevision:revision,action:'stop'},now)).agent})
 agents=createPostgresManagedAgentRepository(db,{codec,worker,mcp:profiles,parseCreate:value=>managed.managedCreateSchema.parse(value),parseChange:value=>managed.managedChangeSchema.parse(value),parseReport:value=>managed.managedReportSchema.parse(value),runtimeStatus:health=>{const result=agentStatusSchema.safeParse(storedHealth(health)?.status);if(!result.success)return null;const {catalog,...report}=result.data;return report},filesystemCapability:config=>config.filesystem?.directories.length?(requiresWorkspaceRoots(config.filesystem)?'managed-filesystem-v2':'managed-filesystem-v1'):undefined})
 const rollout=createPostgresRolloutRepository(db,{worker,parseRequest:value=>rollouts.rolloutRequestSchema.parse(value),parseReport:value=>rollouts.rolloutReportSchema.parse(value)})
 return {terminal,projects:createPostgresProjectRepository(db,codec),workers:worker,managed:agents,mcp:profiles,compaction:createPostgresCompactionRepository(db,{worker,relay,parseRequest:value=>compaction.compactRequestSchema.parse(value)}),rollouts:rollout,control:createPostgresRuntimeControlRepository(db,{terminal,relay,rollouts:rollout,parseGrant:value=>control.runtimeControlGrantInput.parse(value),parseRollout:value=>rollouts.rolloutRequestSchema.parse(value)})}
}
export function createSqliteExecutionServices(db:Database):ExecutionServices {
 const identify=(auth:{id:string;token:string;instance?:string},now?:number)=>auth.instance===undefined?authenticateTerminalConnection(db,auth.token,auth.id,now):validateRelaySocket(db,auth.token,auth.id,auth.instance,now)
 return {
  terminal:{async authenticate(...args){return authenticateTerminalConnection(db,...args)}},
  projects:{...createSqliteProjectAuthorityRepository(db),async create(...args){const row=createProjectBinding(db,...args);return {id:row.id,revision:row.revision}}},
  control:{
   async get(...args){return control.runtimeControlGrant(db,...args)},async update(...args){return control.updateRuntimeControlGrant(db,...args)},
   async describe(auth,now){return db.transaction(()=>{
    const connection=identify(auth,now)
    const row=db.prepare('SELECT w.id,w.revision,w.health FROM managed_agents a JOIN workers w ON w.id=a.worker_id WHERE a.connection_id=? AND a.owner_subject=? AND w.owner_subject=a.owner_subject').get(connection.id,connection.ownerSubject) as {id:string;revision:number;health:string|null}|undefined
    if(!row)return {managed:false as const,canSubmit:false}
    managed.managedAuthority(db,connection.id,now)
    const health=row.health?JSON.parse(row.health):null
    return {managed:true as const,workerId:row.id,workerRevision:row.revision,managerVersion:health?.version??null,runtimeImage:health?.runtimeImage??null,rolloutSupported:health?.capabilities?.includes('managed-runtime-rollout-v1')===true,...control.runtimeControlDelegation(db,connection,now)}
   }).immediate()},
   async requestRollout(auth,input,now){return control.requestDelegatedRuntimeRollout(db,at=>identify(auth,at),input,now)},
   async rollout(auth,id,now){return control.delegatedRuntimeRollout(db,identify(auth,now),id,now)},
  },
  rollouts:{
   async request(...args){return rollouts.requestRuntimeRollout(db,...args)},
   async cancel(...args){return rollouts.cancelRuntimeRollout(db,...args)},
   async get(...args){return rollouts.runtimeRollout(db,...args)},
   async list(...args){return rollouts.runtimeRollouts(db,...args)},
   async poll(...args){return rollouts.pollRuntimeRollout(db,...args)},
   async report(...args){return rollouts.reportRuntimeRollout(db,...args)},
   async resolve(...args){return rollouts.resolveRuntimeRollout(db,...args)},
  },
  workers:{
   async list(...args){return workers.listWorkers(db,...args)},
   async create(...args){return workers.createWorker(db,...args)},
   async change(...args){return workers.changeWorker(db,...args)},
   async projectBinding(...args){return workers.workerProjectBinding(db,...args)},
   async validate(...args){const w=workers.validateWorker(db,...args);return workers.listWorkers(db,w.owner_subject,args[4]).find(row=>row.id===w.id)!},
   async connect(...args){return workers.connectWorker(db,...args)},
   async heartbeat(id,token,instance,generation,health,now){return workers.heartbeatWorker(db,id,token,instance,generation,workers.workerHealthSchema.parse(health),now)},
  },
  managed:{
   async get(owner,id){const agent=managed.listManagedAgents(db,owner).find(a=>a.id===id);if(!agent)throw new workers.WorkerError(404,'managed_agent_not_found');return agent},
   async list(...args){return managed.listManagedAgents(db,...args)},
   async operations(...args){return managed.managedOperations(db,...args)},
   async create(...args){return managed.createManagedAgent(db,...args)},
   async change(...args){return managed.changeManagedAgent(db,...args)},
   async snapshot(...args){return managed.managedSnapshot(db,...args)},
   async grant(...args){return managed.managedGrant(db,...args)},
   async report(...args){return managed.reportManagedAgent(db,...args)},
  },
  mcp:{async list(...args){return mcp.listMcpProfiles(db,...args)},async create(...args){return mcp.createMcpProfile(db,...args)},async remove(...args){return mcp.removeMcpProfile(db,...args)}},
  compaction:{
   async list(...args){return compaction.managedCompactions(db,...args)},
   async request(...args){return compaction.requestManagedCompaction(db,...args)},
   async assign(...args){return compaction.assignManagedCompaction(db,...args)},
   async claim(...args){return compaction.claimManagedCompaction(db,...args)},
   async workerCommands(...args){return compaction.workerCompactions(db,...args)},
   async runtimeCommands(...args){return compaction.runtimeCompactions(db,...args)},
   async acknowledge(...args){return compaction.acknowledgeManagedCompaction(db,...args)},
  },
 }
}
