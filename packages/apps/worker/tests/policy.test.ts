import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect,test,vi} from 'vitest'
const engine=vi.hoisted(()=>({request:vi.fn()}))
vi.mock('../src/engine.js',()=>({engineRequest:engine.request}))
import {configureRuntime,runtimePolicy,workspaceRootsFromEnvironment} from '../src/policy.js'
import {atomicState,type WorkerConfig} from '../src/config.js'
test('additional workspace roots are explicit and invalid input cannot silently fall back',()=>{
 expect(workspaceRootsFromEnvironment({})).toBeUndefined()
 expect(workspaceRootsFromEnvironment({RUE_WORKER_WORKSPACE_ROOTS:'["/Users/calvin/.ssh"]'})).toEqual(['/Users/calvin/.ssh'])
 for(const value of ['invalid','["/control"]','["/data","/data/project"]','["/Users/calvin/.colima"]'])expect(()=>workspaceRootsFromEnvironment({RUE_WORKER_WORKSPACE_ROOTS:value})).toThrow('worker_runtime_policy_invalid')
})
test('operator roots persist with a legacy default image; live containers fence reconfiguration',async()=>{
 const stateDir=mkdtempSync(join(tmpdir(),'rue-policy-roots-')),cfg:WorkerConfig={origin:'https://rue.test',id:'worker',secret:'unused',dockerSocket:'/unused',stateDir},image='sha256:'+'a'.repeat(64),roots=['/Users/calvin/projects']
 let live=false
 engine.request.mockImplementation(async(_socket:string,_method:string,path:string)=>path.startsWith('/images/')?{Id:image,Config:{Labels:{'io.rue.agent-runtime':'1','io.rue.filesystem':'2'}}}:live?[{Id:'existing-agent'}]:[])
 try{
  await configureRuntime(cfg,image,1,true,false,undefined,roots)
  expect(runtimePolicy(cfg,{})?.workspaceRoots).toEqual(roots)
  expect(runtimePolicy(cfg,{})?.image).toBe(image)
  const saved=readFileSync(join(stateDir,'runtime-policy.json'),'utf8');live=true
  await expect(configureRuntime(cfg,image,10,true,false,undefined,[])).rejects.toThrow('worker_runtime_stop_agents_first')
  expect(readFileSync(join(stateDir,'runtime-policy.json'),'utf8')).toBe(saved)
  expect(engine.request.mock.calls.every(call=>call[1]==='GET')).toBe(true)
 }finally{engine.request.mockReset();rmSync(stateDir,{recursive:true,force:true})}
})
test('runtime policy is private and origin/worker bound; absence remains enrollment-only',()=>{
 const stateDir=mkdtempSync(join(tmpdir(),'rue-policy-'))
 const cfg:WorkerConfig={origin:'https://rue.test',id:'worker',secret:'unused',dockerSocket:'/unused',stateDir}
 const policy={origin:cfg.origin,id:cfg.id,image:'sha256:'+'a'.repeat(64),capacity:1}
 try{
  expect(runtimePolicy(cfg,{})).toBeUndefined()
  atomicState(stateDir,'runtime-policy.json',policy)
  expect(runtimePolicy(cfg,{})).toEqual(policy)
  expect(()=>runtimePolicy({...cfg,origin:'https://other.test'},{})).toThrow('worker_runtime_policy_invalid')
  expect(()=>runtimePolicy({...cfg,id:'other'},{})).toThrow('worker_runtime_policy_invalid')
  expect(()=>runtimePolicy(cfg,{RUE_WORKER_AGENT_IMAGE:'latest'})).toThrow('worker_runtime_policy_invalid')
  expect(runtimePolicy(cfg,{RUE_WORKER_AGENT_IMAGE:policy.image,RUE_WORKER_AGENT_LIMIT:'8'})?.capacity).toBe(8)
  for(const limit of ['0','-1','1.5','Infinity','9007199254740992'])expect(()=>runtimePolicy(cfg,{RUE_WORKER_AGENT_IMAGE:policy.image,RUE_WORKER_AGENT_LIMIT:limit})).toThrow('worker_runtime_policy_invalid')
  expect(JSON.parse(readFileSync(join(stateDir,'runtime-policy.json'),'utf8'))).toEqual(policy)
  expect(()=>atomicState(stateDir,'boot-../../other.json',{})).toThrow('worker_state_name_invalid')
 }finally{rmSync(stateDir,{recursive:true,force:true})}
})
