import {beforeEach,expect,test,vi} from 'vitest'
import {createHash} from 'node:crypto'
const mock=vi.hoisted(()=>({request:vi.fn()}))
vi.mock('../src/engine.js',async()=>({...await vi.importActual('../src/engine.js'),engineRequest:mock.request}))
import {AgentContainers} from '../src/containers.js'
const worker='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',image='sha256:'+'a'.repeat(64),container='b'.repeat(64),helper='c'.repeat(64),origin='https://rue.test'
const scope=createHash('sha256').update(origin+'\0'+worker).digest('hex')
let body:any,tamper=false,filesystemVersion='2'
const agent:any={id,desired:'running',config:{provider:'openai',model:'model',permission:'coding',mounts:[],shareToolOutput:false,shareThinking:false,filesystem:{version:1,directories:[{path:'/Volumes/MOTHERSHIP/project',access:'read'}]}}}
beforeEach(()=>{body=undefined;tamper=false;filesystemVersion='2';mock.request.mockReset();mock.request.mockImplementation(async(_socket,method,path,value)=>{
 if(path.startsWith('/images/'))return {Id:image,Config:{Labels:{'io.rue.agent-runtime':'1','io.rue.filesystem':filesystemVersion},Entrypoint:['guardian'],Env:[]}}
 if(path.startsWith('/volumes/')){const name=path.slice('/volumes/'.length),role=name.split('-').at(-1);return {Name:name,Driver:'local',Scope:'local',Options:{},Labels:{'io.rue.scope':scope,'io.rue.agent':id,'io.rue.role':role},Mountpoint:'/var/lib/docker/volumes/'+name+'/_data'}}
 if(path==='/containers/create')return {Id:helper}
 if(path.startsWith('/containers/create?')){body=value;return {Id:container}}
 if(path===`/containers/${container}/json`)return {Id:container,Image:image,State:{Running:false},Config:{...body,Labels:{'io.rue.filesystem':filesystemVersion,...body.Labels},Entrypoint:['guardian'],Env:[]},HostConfig:{...body.HostConfig,Tmpfs:Object.fromEntries(Object.entries(body.HostConfig.Tmpfs).sort()),Mounts:body.HostConfig.Mounts.map(({ReadOnly,...m}:any)=>ReadOnly?{...m,ReadOnly}:m)},Mounts:body.HostConfig.Mounts.map((m:any)=>m.Type==='volume'?{Type:'volume',Name:m.Source,Destination:m.Target,RW:true}:{Type:'bind',Source:m.Source,Destination:m.Target,RW:tamper?true:!m.ReadOnly,Propagation:'rprivate'})}
 return {}
})})
test('filesystem opt-in binds only selected sources and starts a bounded credential-free descriptor probe',async()=>{
 const c=new AgentContainers('socket',worker,origin,image,()=>{},true)
 await c.start(agent,{revision:1,generation:1,boot:1,attempts:1,retryAt:1},{token:'synthetic-terminal'})
 const probe=mock.request.mock.calls.find(call=>call[2]==='/containers/create')![3]
 expect(probe.Entrypoint).toEqual(['/app/mount-check']);expect(probe.Cmd[0]).toBe('serve');expect(JSON.stringify(probe)).not.toContain('synthetic-terminal')
 expect(probe.HostConfig).toMatchObject({AutoRemove:true,NetworkMode:'none',Privileged:false,CapDrop:['ALL']})
 expect(body.HostConfig.Mounts.at(-1)).toEqual({Type:'bind',Source:'/Volumes/MOTHERSHIP/project',Target:'/Volumes/MOTHERSHIP/project',ReadOnly:true,BindOptions:{Propagation:'rprivate',NonRecursive:true}})
 const archive=mock.request.mock.calls.find(call=>call[1]==='PUT')![3] as Buffer
 expect(archive.toString()).toContain('filesystemProof');expect(archive.toString()).toContain(probe.Cmd[1])
 expect(mock.request.mock.calls.findIndex(call=>call[1]==='PUT')).toBeLessThan(mock.request.mock.calls.findIndex(call=>call[2]===`/containers/${container}/start`))
})
test('Docker omits false ReadOnly and inherits image labels for private-only agents',async()=>{
 const c=new AgentContainers('socket',worker,origin,image,()=>{},true),intent={revision:1,generation:1,boot:1,attempts:1,retryAt:1}
 await c.start({...agent,config:{...agent.config,filesystem:{version:1,directories:[{path:'/Volumes/MOTHERSHIP',access:'write'}]}}},intent,{})
 expect(body.Labels['io.rue.filesystem-policy']).toContain('write')
 expect(body.HostConfig.Tmpfs['/Volumes/MOTHERSHIP/.rue-colima-cache']).toBe('ro,nosuid,nodev,noexec,size=1048576,mode=0000')
 await c.start({...agent,config:{...agent.config,filesystem:undefined}},intent,{})
 expect(body.HostConfig.Mounts).toHaveLength(3)
})
test('v3 uses only approved roots and carries the same proof roots to the guardian',async()=>{
 filesystemVersion='3'
 const outside={...agent,config:{...agent.config,filesystem:{version:1,directories:[{path:'/Users/calvin/.ssh',access:'read'}]}}}
 const c=new AgentContainers('socket',worker,origin,image,()=>{},true,['/Users/calvin/.ssh'])
 await c.start(outside,{revision:1,generation:1,boot:1,attempts:1,retryAt:1},{})
 expect(c.supportsWorkspaceRoots).toBe(true)
 const probe=mock.request.mock.calls.find(call=>call[2]==='/containers/create')![3]
 expect(probe.Cmd.slice(0,4)).toEqual(['serve-v3',expect.any(String),'1','/Users/calvin/.ssh'])
 expect(probe.HostConfig.Mounts).toHaveLength(3)
 expect(probe.HostConfig.Mounts[2]).toMatchObject({Source:'/proc/1/mountinfo',Target:'/app/host-mountinfo',ReadOnly:true})
 expect(probe.HostConfig.Mounts[1]).toMatchObject({Source:'/Users/calvin/.ssh',Target:'/Users/calvin/.ssh',ReadOnly:true,BindOptions:{NonRecursive:true}})
 expect(body.HostConfig.Mounts.at(-1)).toMatchObject({Source:'/Users/calvin/.ssh',ReadOnly:true})
 expect(body.HostConfig.Mounts.some((mount:any)=>mount.Source==='/proc/1/mountinfo')).toBe(false)
 const archive=mock.request.mock.calls.find(call=>call[1]==='PUT')![3] as Buffer
 expect(archive.toString()).toContain('"workspaceRoots":["/Users/calvin/.ssh"]')
})
test('one v3 assignment enables roots without changing the default image for other agents',async()=>{
 const upgraded='sha256:'+'c'.repeat(64),original=mock.request.getMockImplementation()!
 mock.request.mockImplementation(async(...args:any[])=>args[2]===`/images/${upgraded}/json`?{Id:upgraded,Config:{Labels:{'io.rue.agent-runtime':'1','io.rue.filesystem':'3'},Entrypoint:['guardian'],Env:[]}}:original(...args))
 const c=new AgentContainers('socket',worker,origin,image,()=>{},true,['/Users/calvin/.ssh'])
 const selected={...agent,id:'selected-agent',runtimeImage:upgraded}
 c.configureAgents([agent,selected])
 await c.prepare(agent);expect(c.supportsWorkspaceRoots).toBe(false)
 await c.prepare(selected);expect(c.supportsWorkspaceRoots).toBe(true)
 await c.prepare({...selected,config:{...agent.config,filesystem:{version:1,directories:[{path:'/Users/calvin/.ssh',access:'read'}]}}})
 await c.prepare(agent);expect(c.image).toBe(image)
 expect(mock.request.mock.calls.every(call=>call[1]==='GET')).toBe(true)
})
test('v2 images and roots not approved by the operator cannot start nonlegacy grants',async()=>{
 const outside={...agent,config:{...agent.config,filesystem:{version:1,directories:[{path:'/Users/calvin/.ssh',access:'read'}]}}},intent={revision:1,generation:1,boot:1,attempts:1,retryAt:1}
 await expect(new AgentContainers('socket',worker,origin,image,()=>{},true,['/Users/calvin/.ssh']).start(outside,intent,{})).rejects.toThrow('worker_mount_unavailable')
 filesystemVersion='3'
 await expect(new AgentContainers('socket',worker,origin,image,()=>{},true,['/Users/calvin/projects']).start(outside,intent,{})).rejects.toThrow('worker_mount_unavailable')
 expect(mock.request.mock.calls.some(call=>call[1]!=='GET')).toBe(false)
})
test('missing operator opt-in and altered read-only mounts fail closed',async()=>{
 await expect(new AgentContainers('socket',worker,origin,image,()=>{}).start(agent,{revision:1,generation:1,boot:1,attempts:1,retryAt:1},{})).rejects.toThrow('worker_mount_unavailable')
 expect(mock.request.mock.calls.some(call=>call[2]==='/containers/create')).toBe(false)
 tamper=true
 await expect(new AgentContainers('socket',worker,origin,image,()=>{},true).start(agent,{revision:1,generation:1,boot:1,attempts:1,retryAt:1},{})).rejects.toThrow('worker_ownership_conflict')
 expect(mock.request.mock.calls.some(call=>call[2]===`/containers/${container}/start`)).toBe(false)
})
