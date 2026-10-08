import {and,eq,inArray,notInArray} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {managedAgents,workers,projectBindings,managedCompactions,runtimeRollouts,terminalConnections,terminalCommands} from './schema.js'
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]
export class ManagedAuthorityExpired extends Error{constructor(){super('managed_authority_expired')}}
/** Caller holds the owner advisory lock. No renewal and no network verification.
 * A managed terminal's credential cannot outlive its worker/project authority. */
export async function postgresManagedAuthority(tx:Tx,connectionId:string,owner:string,now=Date.now()):Promise<number|undefined>{
 const [agent]=await tx.select().from(managedAgents).where(eq(managedAgents.connectionId,connectionId))
 if(!agent)return
 const [worker]=await tx.select().from(workers).where(eq(workers.id,agent.workerId))
 if(agent.ownerSubject!==owner||worker?.ownerSubject!==owner)throw new ManagedAuthorityExpired()
 let projectUntil=Infinity
 if(worker.projectBindingId){
  const [binding]=await tx.select().from(projectBindings).where(eq(projectBindings.id,worker.projectBindingId)).for('share')
  projectUntil=binding&&binding.ownerSubject===owner&&binding.revokedAt===null&&binding.encryptedKey&&now>=binding.verifiedAt?Math.min(binding.expiresAt,binding.authorizedUntil,binding.verifiedAt+45000):0
 }
 const [currentWorker]=await tx.select().from(workers).where(eq(workers.id,worker.id)).for('share')
 const [currentAgent]=await tx.select().from(managedAgents).where(eq(managedAgents.id,agent.id)).for('share')
 if(!currentWorker||!currentAgent||currentAgent.ownerSubject!==owner||currentWorker.ownerSubject!==owner||currentAgent.workerId!==worker.id||currentWorker.projectBindingId!==worker.projectBindingId||currentAgent.connectionId!==connectionId||currentAgent.desired!=='running'||currentAgent.grantRevision===null||currentWorker.revokedAt!==null||currentAgent.grantGeneration!==currentWorker.generation||!currentWorker.leaseExpiresAt||currentWorker.leaseExpiresAt<=now||currentWorker.lastSeenAt===null||now<currentWorker.lastSeenAt)throw new ManagedAuthorityExpired()
 const until=Math.min(currentWorker.leaseExpiresAt,projectUntil)
 if(until<=now)throw new ManagedAuthorityExpired()
 return until
}
export async function postgresCompactionHoldsRuntime(tx:Tx,connectionId:string,runningOnly=false){
 const [row]=await tx.select({id:managedCompactions.id}).from(managedCompactions).innerJoin(managedAgents,eq(managedAgents.id,managedCompactions.agentId)).where(and(eq(managedAgents.connectionId,connectionId),eq(managedCompactions.revision,managedAgents.grantRevision),eq(managedCompactions.generation,managedAgents.grantGeneration),eq(managedCompactions.boot,managedAgents.grantBoot),inArray(managedCompactions.status,runningOnly?['running','uncertain']:['queued','assigned','running','uncertain']))).limit(1)
 return Boolean(row)
}
export async function postgresManagedBusy(tx:Tx,connectionId:string|null,now=Date.now()){
 if(!connectionId)return false
 const [host]=await tx.select().from(terminalConnections).where(eq(terminalConnections.id,connectionId))
 if(!host?.leaseExpiresAt||host.leaseExpiresAt<=now)return false
 if(await postgresCompactionHoldsRuntime(tx,connectionId,true))return true
 const [command]=await tx.select({id:terminalCommands.id}).from(terminalCommands).where(and(eq(terminalCommands.connectionId,connectionId),inArray(terminalCommands.status,['claimed','running']))).limit(1)
 if(command)return true
 const health=host.relayHealth?JSON.parse(host.relayHealth):null
 return health?.agentWorking===true||Number(health?.pendingCount)>0
}
export async function postgresManagedAcceptingPrompts(tx:Tx,connectionId:string,owner:string,now=Date.now()){
 const [agent]=await tx.select().from(managedAgents).where(eq(managedAgents.connectionId,connectionId));if(!agent)return true
 try{await postgresManagedAuthority(tx,connectionId,owner,now)}catch(error){if(error instanceof ManagedAuthorityExpired)return false;throw error}
 const [worker]=await tx.select().from(workers).where(eq(workers.id,agent.workerId))
 const [rollout]=await tx.select({id:runtimeRollouts.id}).from(runtimeRollouts).where(and(eq(runtimeRollouts.workerId,agent.workerId),notInArray(runtimeRollouts.phase,['preflight','succeeded','failed']))).limit(1)
 return !rollout&&!['updating','rolling_back'].includes(agent.runtimeUpdateState??'')&&worker?.desired==='active'&&agent.revision===agent.grantRevision&&!await postgresCompactionHoldsRuntime(tx,connectionId)
}
