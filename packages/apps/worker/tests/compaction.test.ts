import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,test,vi} from 'vitest'
import {ManagedSupervisor} from '../src/managed.js'
const mocks=vi.hoisted(()=>({inventory:vi.fn(),capable:true}))
vi.mock('../src/containers.js',()=>({AgentContainers:class{get supportsCompact(){return mocks.capable}get supportsMcp(){return false}configureAgents(){}inventory=mocks.inventory}}))
vi.mock('../src/reconcile.js',()=>({reconcile:async()=>({accepting:true})}))
const dirs:string[]=[]
afterEach(()=>{dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true}));vi.restoreAllMocks();mocks.capable=true;mocks.inventory.mockReset()})
async function run(modify:(command:any,agent:any)=>void=()=>{},inventoryFailure=false){
 const dir=mkdtempSync(join(tmpdir(),'rue-worker-compact-'));dirs.push(dir)
 const worker=randomUUID(),id=randomUUID(),instance=randomUUID(),now=Date.now(),command={id:randomUUID(),agentId:id,revision:3,generation:2,boot:4}
 const agent={id,workerId:worker,sessionId:'ses_test',connectionId:'term_test',name:'Test',desired:'running',revision:3,createdAt:now,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareThinking:false,shareToolOutput:false},observed:'running',observedRevision:3,observedGeneration:2,observedAt:now,error:null,busy:false,connected:true,grantRevision:3,grantGeneration:2,grantBoot:4}
 modify(command,agent)
 if(inventoryFailure)mocks.inventory.mockRejectedValue(Error('worker_ownership_conflict'));else mocks.inventory.mockResolvedValue([{id:'container',agentId:id,revision:3,generation:2,boot:4,running:true}])
 const calls:string[]=[]
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  const path=new URL(String(url)).pathname;calls.push(path);expect(init?.redirect).toBe('error')
  if(path.endsWith('/snapshot'))return Response.json({generation:2,serverNow:now,expiresAt:now+60000,desired:'active',agents:[agent]})
  if(path.endsWith('/compactions'))return Response.json({commands:[command]})
  if(path.endsWith('/assign'))return Response.json({...command,status:'assigned'})
  throw Error('unexpected request')
 })
 const manager=new ManagedSupervisor({origin:'https://rue.test',id:worker,secret:'synthetic',stateDir:dir,dockerSocket:'/unavailable'},instance,'sha256:'+'a'.repeat(64))
 manager.observed({protocol:1,generation:2,serverNow:now,expiresAt:now+60000,worker:{ownerSubject:'owner'}} as never,{mono:performance.now()+60000,wall:now+60000})
 if(inventoryFailure)await expect(manager.tick()).rejects.toThrow('worker_ownership_conflict');else await manager.tick()
 return calls.filter(path=>path.endsWith('/assign'))
}
test('manager assigns only to the verified matching running container',async()=>{expect(await run()).toHaveLength(1)})
test.each(['boot','generation','revision'])('stale %s command cannot be assigned',async field=>{expect(await run(command=>{command[field]++})).toEqual([])})
test('busy agents, unavailable image capabilities and ownership conflicts never authorize compaction',async()=>{
 expect(await run((_command,agent)=>{agent.busy=true})).toEqual([])
 mocks.capable=false;expect(await run()).toEqual([])
 mocks.capable=true;expect(await run(()=>{},true)).toEqual([])
})
