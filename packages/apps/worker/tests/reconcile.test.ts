import {expect,test,vi} from 'vitest'
import {reconcile,type AgentTarget,type ReconcilePorts,type RuntimeContainer,type BootIntent} from '../src/reconcile.js'
const target=():AgentTarget=>({id:'agent',workerId:'worker',sessionId:'session',connectionId:'connection',name:'Agent',createdAt:0,desired:'running',revision:1,observed:'pending',observedRevision:null,observedGeneration:null,observedAt:null,error:null,config:{provider:'openai',model:'model',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false},busy:false,connected:false,grantRevision:null,grantGeneration:null,grantBoot:null})
function fixture(containers:RuntimeContainer[]=[]){
 const intents=new Map<string,BootIntent>(),calls:string[]=[]
 const ports:ReconcilePorts={authorized:()=>true,inventory:async()=>containers,load:id=>intents.get(id),save:(id,intent)=>{calls.push('save');intents.set(id,intent)},remove:vi.fn(async()=>{calls.push('remove')}),purge:vi.fn(async()=>{calls.push('purge')}),start:vi.fn(async()=>{calls.push('start')}),report:vi.fn(async()=>{})}
 return {ports,intents,calls}
}
const container:RuntimeContainer={id:'container',agentId:'agent',generation:1,revision:1,boot:1,running:true}
test('boot intent is durable before starting; a lost response retries the same boot',async()=>{
 const {ports,intents,calls}=fixture(),a=target()
 ports.start=vi.fn(async()=>{calls.push('start');throw Error('lost_ack')})
 await reconcile({generation:1,desired:'active',agents:[a]},ports,1,0)
 expect(calls).toEqual(['save','start']);expect(intents.get(a.id)?.boot).toBe(1)
 a.grantBoot=1;a.grantRevision=1;a.grantGeneration=1
 await reconcile({generation:1,desired:'active',agents:[a]},ports,1,10001)
 expect(intents.get(a.id)?.boot).toBe(1)
})
test('an exited process rotates the boot while retaining identity and storage',async()=>{
 const {ports,intents}=fixture([{...container,running:false}]),a={...target(),grantBoot:1,grantRevision:1,grantGeneration:1}
 await reconcile({generation:1,desired:'active',agents:[a]},ports,1,0)
 expect(ports.remove).toHaveBeenCalledWith({...container,running:false})
 expect(intents.get(a.id)?.boot).toBe(2)
})
test('reload drains work; stop takes precedence; future generations and unknown agents are never removed',async()=>{
 const {ports}=fixture([container]),a={...target(),revision:2,busy:true,grantBoot:1,grantRevision:1,grantGeneration:1}
 await reconcile({generation:1,desired:'active',agents:[a]},ports,1,0)
 expect(ports.remove).not.toHaveBeenCalled()
 a.desired='stopped';await reconcile({generation:1,desired:'active',agents:[a]},ports,1,0)
 expect(ports.remove).toHaveBeenCalledTimes(1)
 const future=fixture([{...container,generation:2}])
 await expect(reconcile({generation:1,desired:'active',agents:[target()]},future.ports,1)).rejects.toThrow('worker_generation_conflict')
 expect(future.ports.remove).not.toHaveBeenCalled()
 const unknown=fixture([container])
 await expect(reconcile({generation:1,desired:'active',agents:[]},unknown.ports,1)).rejects.toThrow('worker_ownership_conflict')
})
test('purge is separate from destruction and follows runtime removal',async()=>{
 const {ports,calls}=fixture([container]),a={...target(),desired:'destroyed' as const,purgeRequested:true,purgedAt:null}
 await reconcile({generation:1,desired:'active',agents:[a]},ports,1)
 expect(calls).toEqual(['remove','purge'])
 expect(ports.report).toHaveBeenCalledWith(a,'purged',1,null)
 const ordinary=fixture([container]);a.purgeRequested=false
 await reconcile({generation:1,desired:'active',agents:[a]},ordinary.ports,1)
 expect(ordinary.ports.purge).not.toHaveBeenCalled()
})
test('capacity, host drain and unconfigured mounts fail closed',async()=>{
 for(const [capacity,desired,mounts] of [[0,'active',[]],[1,'draining',[]],[1,'active',['repo']]] as const){
  const {ports}=fixture(),a=target();a.config.mounts=[...mounts]
  await reconcile({generation:1,desired,agents:[a]},ports,capacity)
  expect(ports.start).not.toHaveBeenCalled()
 }
})
test('authority is rechecked after asynchronous Docker operations',async()=>{
 const {ports}=fixture(),a=target()
 ports.start=async()=>{ports.authorized=()=>false}
 await expect(reconcile({generation:1,desired:'active',agents:[a]},ports,1)).rejects.toThrow('worker_authority_lost')
 expect(ports.report).not.toHaveBeenCalled()
})
