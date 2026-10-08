import {AGENT_RESOURCES,AGENT_TMP_BYTES,LEGACY_AGENT_TMP_BYTES,resourceProfile} from './resources.js'
import {createHash,randomUUID} from 'node:crypto'
import {validFilesystemPolicy,validWorkspaceRoots,beneathDirectory,requiresWorkspaceRoots,workspaceRoot,protectedWorkspaceRoot,type FilesystemPolicy} from '@multiterm/rue-sdk/filesystem'
import {engineRequest,EngineError,grantArchive} from './engine.js'
import type {AgentTarget,BootIntent,RuntimeContainer} from './reconcile.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const digest=/^sha256:[0-9a-f]{64}$/
const roles=['control','state','workspace'] as const
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
function agentTmpfs(filesystem:FilesystemPolicy={version:1,directories:[]},bytes=AGENT_TMP_BYTES){return {'/tmp':`rw,nosuid,nodev,noexec,size=${bytes},mode=1777`,...(filesystem.directories.some(g=>g.path===workspaceRoot)?{[protectedWorkspaceRoot]:'ro,nosuid,nodev,noexec,size=1048576,mode=0000'}:{})}}
export class AgentContainers {
 readonly scope:string
 private imageConfig:any
 private readonly imageConfigs=new Map<string,any>()
 private assignedImages:Map<string,Set<string>>|undefined
 configureAgents(agents:AgentTarget[]){this.assignedImages=new Map(agents.map(a=>[a.id,new Set([a.runtimeImage??this.image,...(a.previousRuntimeImage?[a.previousRuntimeImage]:[])])]))}
 private permits(agentId:string,image:string){return this.assignedImages?Boolean(this.assignedImages.get(agentId)?.has(image)):image===this.image}
 get supportsFilesystem(){return (this.mothership&&['2','3'].includes(this.imageConfig?.Labels?.['io.rue.filesystem']))||this.supportsWorkspaceRoots}
 get supportsWorkspaceRoots(){return this.workspaceRoots.length>0&&[...this.imageConfigs.values()].some(config=>config?.Labels?.['io.rue.filesystem']==='3')}
 private get approvedRoots(){return [...new Set([...(this.mothership?[workspaceRoot]:[]),...this.workspaceRoots])]}
 private rootsFor(filesystem:FilesystemPolicy,labels:any){
  if(!validFilesystemPolicy(filesystem))throw Error('worker_mount_unavailable')
  if(!filesystem.directories.length)return []
  if(!['2','3'].includes(labels?.['io.rue.filesystem'])||((requiresWorkspaceRoots(filesystem)||!this.approvedRoots.includes(workspaceRoot))&&labels?.['io.rue.filesystem']!=='3'))throw Error('worker_mount_unavailable')
  if(filesystem.directories.some(g=>!this.approvedRoots.some(root=>beneathDirectory(g.path,root))))throw Error('worker_mount_unavailable')
  return this.approvedRoots.filter(root=>filesystem.directories.some(g=>beneathDirectory(g.path,root)))
 }
 get supportsCodex(){return this.imageConfig?.Labels?.['io.rue.codex-oauth']==='1'}
 get supportsCompact(){return this.imageConfig?.Labels?.['io.rue.compact']==='1'}
 get supportsMcp(){return this.imageConfig?.Labels?.['io.rue.mcp-tools']==='1'}
 private async verifyImage(image=this.image){
  if(!digest.test(image)||image.length!==71)throw Error('worker_runtime_image_invalid')
  const value=await this.request('GET',`/images/${image}/json`)
  if(value.Id!==image||value.Config?.Labels?.['io.rue.agent-runtime']!=='1')throw Error('worker_runtime_image_invalid')
  this.imageConfigs.set(image,value.Config)
  if(image===this.image)this.imageConfig=value.Config
 }
 async prepare(agent:AgentTarget){
  const image=agent.runtimeImage??this.image
  if(!this.permits(agent.id,image))throw Error('worker_ownership_conflict')
  await this.verifyImage(image)
  const labels=this.imageConfigs.get(image)?.Labels
  if(agent.runtimeUpdateState==='updating'&&(!agent.runtimeUpdateVersion||labels?.['io.rue.pi-sdk']!==agent.runtimeUpdateVersion))throw Error('worker_runtime_image_invalid')
  if(agent.config.mcp?.length&&labels?.['io.rue.mcp-tools']!=='1')throw Error('worker_mcp_image_required')
  if(agent.config.provider==='openai-codex'&&labels?.['io.rue.codex-oauth']!=='1')throw Error('worker_codex_image_required')
  if(agent.config.filesystem)this.rootsFor(agent.config.filesystem,labels)
 }
 constructor(readonly socket:string,readonly workerId:string,readonly origin:string,readonly image:string,readonly check:()=>void,readonly mothership=false,readonly workspaceRoots:string[]=[]){
  if(!validWorkspaceRoots(workspaceRoots)||!validWorkspaceRoots(this.approvedRoots))throw Error('worker_runtime_configuration_invalid')
  if(!uuid.test(workerId)||workerId.length!==36||!digest.test(image)||image.length!==71)throw Error('worker_runtime_configuration_invalid')
  this.scope=createHash('sha256').update(origin+'\0'+workerId).digest('hex')
 }
 private async request(method:string,path:string,body?:unknown){this.check();const result=await engineRequest(this.socket,method,path,body);this.check();return result as any}
 private volume(agentId:string,role:string){return `rue-agent-${this.scope.slice(0,20)}-${agentId}-${role}`}
 private labels(agentId:string){return {'io.rue.scope':this.scope,'io.rue.agent':agentId}}
 private parse(value:any):RuntimeContainer{
  const labels=value?.Config?.Labels??{},id=labels['io.rue.agent']
  const numbers=['generation','revision','boot'].map(k=>Number(labels['io.rue.'+k]))
  const host=value?.HostConfig,imageConfig=this.imageConfigs.get(value?.Image)
  let filesystem:FilesystemPolicy={version:1,directories:[]}
  if(labels['io.rue.filesystem-policy']){try{filesystem=JSON.parse(labels['io.rue.filesystem-policy'])}catch{throw Error('worker_ownership_conflict')}
   try{this.rootsFor(filesystem,imageConfig?.Labels)}catch{throw Error('worker_ownership_conflict')}
  }
  const directories=filesystem.directories
  if(directories.some(g=>!value.Mounts?.some((m:any)=>m.Type==='bind'&&m.Source===g.path&&m.Destination===g.path&&m.RW===(g.access==='write')&&m.Propagation==='rprivate')||!host?.Mounts?.some((m:any)=>m.Type==='bind'&&m.Source===g.path&&m.Target===g.path&&Boolean(m.ReadOnly)===(g.access==='read')&&m.BindOptions?.NonRecursive===true&&m.BindOptions?.Propagation==='rprivate')))throw Error('worker_ownership_conflict')
  const sources=roles.map(role=>({role,source:this.volume(id,role)}))
  if(labels['io.rue.scope']!==this.scope||!uuid.test(id??'')||id.length!==36||numbers.some(n=>!Number.isSafeInteger(n)||n<1)||
    !imageConfig||!this.permits(id,value.Image)||value.Config.User!=='0:0'||value.Config.WorkingDir!=='/workspace'||
    !same(value.Config.Entrypoint,imageConfig?.Entrypoint)||!same(value.Config.Env,imageConfig?.Env)||value.Config.Cmd?.length||
    !same(Object.entries(host?.Tmpfs??{}).sort(),Object.entries(agentTmpfs(filesystem,resourceProfile(host)==='legacy'?LEGACY_AGENT_TMP_BYTES:AGENT_TMP_BYTES)).sort())||host.UsernsMode||host.GroupAdd?.length||host.DeviceCgroupRules?.length||
    host?.Privileged!==false||host.ReadonlyRootfs!==true||host.NetworkMode!=='bridge'||host.PidMode||host.IpcMode!=='private'||
    !same(host.CapDrop,['ALL'])||!same(host.CapAdd,['SETUID','SETGID'])||!host.SecurityOpt?.includes('no-new-privileges:true')||
    !resourceProfile(host)||
    host.RestartPolicy?.Name!=='no'||Object.keys(host.PortBindings??{}).length||host.Devices?.length||host.DeviceRequests?.length||
    !Array.isArray(value.Mounts)||value.Mounts.length!==3+directories.length||sources.some(({role,source})=>!value.Mounts.some((m:any)=>m.Type==='volume'&&m.Name===source&&m.Destination==='/'+role&&m.RW===true))||
    typeof value.Id!=='string'||!/^[0-9a-f]{64}$/.test(value.Id))throw Error('worker_ownership_conflict')
  return {id:value.Id,agentId:id,generation:numbers[0]!,revision:numbers[1]!,boot:numbers[2]!,running:value.State?.Running===true}
 }
 async inventory():Promise<RuntimeContainer[]>{
  await this.verifyImage()
  const values=await this.request('GET','/containers/json?all=1&filters='+encodeURIComponent(JSON.stringify({label:[`io.rue.scope=${this.scope}`]})))
  if(!Array.isArray(values)||values.length>128)throw Error('worker_ownership_conflict')
  const result:RuntimeContainer[]=[]
  for(const item of values){if(!/^[0-9a-f]{64}$/.test(item.Id))throw Error('worker_ownership_conflict');const actual=await this.request('GET',`/containers/${item.Id}/json`);if(!this.permits(actual.Config?.Labels?.['io.rue.agent'],actual.Image))throw Error('worker_ownership_conflict');if(!this.imageConfigs.has(actual.Image))await this.verifyImage(actual.Image);result.push(this.parse(actual))}
  return result
 }
 async remove(container:RuntimeContainer){
  await this.verifyImage()
  let actual:RuntimeContainer
  try{actual=this.parse(await this.request('GET',`/containers/${container.id}/json`))}catch(e){if(e instanceof EngineError&&e.status===404)return;throw e}
  if(actual.agentId!==container.agentId||actual.generation!==container.generation||actual.revision!==container.revision||actual.boot!==container.boot)throw Error('worker_ownership_conflict')
  if(actual.running)await this.request('POST',`/containers/${actual.id}/stop?t=2`)
  // Retain history/workspaces, not reusable bootstrap credentials. Docker can
  // replace this root-only file while the container is stopped.
  await this.request('PUT',`/containers/${actual.id}/archive?path=/control`,grantArchive({revoked:true}))
  // No force, no anonymous-volume deletion, and never delete named volumes here.
  await this.request('DELETE',`/containers/${actual.id}?v=0`)
 }
 async purge(agent:AgentTarget){
  if(agent.desired!=='destroyed'||agent.purgeRequested!==true||!uuid.test(agent.id)||agent.id.length!==36)throw Error('worker_purge_not_authorized')
  if((await this.inventory()).some(c=>c.agentId===agent.id))throw Error('worker_purge_runtime_present')
  for(const role of roles){
   const name=this.volume(agent.id,role)
   let volume:any
   try{volume=await this.request('GET',`/volumes/${name}`)}catch(e){if(e instanceof EngineError&&e.status===404)continue;throw e}
   if(volume.Name!==name||volume.Driver!=='local'||volume.Scope!=='local'||Object.keys(volume.Options??{}).length||
    volume.Labels?.['io.rue.scope']!==this.scope||volume.Labels?.['io.rue.agent']!==agent.id||volume.Labels?.['io.rue.role']!==role||
    typeof volume.Mountpoint!=='string'||!volume.Mountpoint.endsWith(`/volumes/${name}/_data`)||volume.Mountpoint.startsWith('/Volumes/'))throw Error('worker_private_volume_invalid')
   // Docker refuses volumes still referenced by any container. Never force or
   // translate this operation into recursive filesystem/host-bind deletion.
   await this.request('DELETE',`/volumes/${name}?force=false`)
  }
 }
 async start(agent:AgentTarget,intent:BootIntent,grant:unknown){
  if(!uuid.test(agent.id)||agent.id.length!==36||agent.config.mounts.length)throw Error('worker_mount_unavailable')
  await this.prepare(agent)
  const image=agent.runtimeImage??this.image,imageConfig=this.imageConfigs.get(image)
  for(const role of roles){
   const name=this.volume(agent.id,role),labels={...this.labels(agent.id),'io.rue.role':role}
   let volume:any
   try{volume=await this.request('GET',`/volumes/${name}`)}catch(e){if(!(e instanceof EngineError)||e.status!==404)throw e;volume=await this.request('POST','/volumes/create',{Name:name,Driver:'local',Labels:labels})}
   if(volume.Name!==name||volume.Driver!=='local'||volume.Scope!=='local'||Object.keys(volume.Options??{}).length||
    Object.entries(labels).some(([k,v])=>volume.Labels?.[k]!==v)||typeof volume.Mountpoint!=='string'||!volume.Mountpoint.endsWith(`/volumes/${name}/_data`)||volume.Mountpoint.startsWith('/Volumes/'))throw Error('worker_private_volume_invalid')
  }
  const filesystem=agent.config.filesystem
  const roots=filesystem?this.rootsFor(filesystem,imageConfig?.Labels):[]
  const extended=roots.length>0&&imageConfig?.Labels?.['io.rue.filesystem']==='3'
  const directories=filesystem?.directories??[]
  const proof=directories.length?randomUUID():undefined
  if(proof){
   const helper=await this.request('POST','/containers/create',{
    Image:image,User:'0:0',Entrypoint:['/app/mount-check'],Cmd:[...(extended?['serve-v3',proof,String(roots.length),...roots]:['serve',proof]),...directories.flatMap(g=>[g.access,g.path])],
    Labels:{'io.rue.probe-scope':this.scope,'io.rue.agent':agent.id,'io.rue.boot':String(intent.boot)},
    HostConfig:{AutoRemove:true,NetworkMode:'none',IpcMode:'private',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:['SETUID','SETGID'],SecurityOpt:['no-new-privileges:true'],Memory:33554432,MemorySwap:33554432,NanoCpus:100000000,PidsLimit:8,RestartPolicy:{Name:'no'},LogConfig:{Type:'json-file',Config:{'max-size':'1m','max-file':'1'}},Mounts:[{Type:'volume',Source:this.volume(agent.id,'control'),Target:'/control',ReadOnly:false},...roots.map(root=>({Type:'bind',Source:root,Target:root,ReadOnly:true,BindOptions:{Propagation:'rprivate',NonRecursive:true}})),...(extended?[{Type:'bind',Source:'/proc/1/mountinfo',Target:'/app/host-mountinfo',ReadOnly:true,BindOptions:{Propagation:'rprivate',NonRecursive:true}}]:[])]}
   })
   if(!/^[0-9a-f]{64}$/.test(helper.Id))throw Error('worker_ownership_conflict')
   try{await this.request('POST',`/containers/${helper.Id}/start`)}catch(error){await this.request('DELETE',`/containers/${helper.Id}?v=0`).catch(()=>{});throw error}
  }
  const labels={...this.labels(agent.id),...(directories.length?{'io.rue.filesystem-policy':JSON.stringify(filesystem)}:{}),'io.rue.generation':String(intent.generation),'io.rue.revision':String(intent.revision),'io.rue.boot':String(intent.boot)}
  const name=`rue-agent-${this.scope.slice(0,20)}-${agent.id}-${intent.generation}-${intent.revision}-${intent.boot}`
  const body={Image:image,User:'0:0',WorkingDir:'/workspace',Labels:labels,Cmd:[],HostConfig:{
   NetworkMode:'bridge',IpcMode:'private',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:['SETUID','SETGID'],SecurityOpt:['no-new-privileges:true'],
   ...AGENT_RESOURCES,RestartPolicy:{Name:'no'},
   LogConfig:{Type:'json-file',Config:{'max-size':'5m','max-file':'2'}},
   Tmpfs:agentTmpfs(filesystem),
   Mounts:[...roles.map(role=>({Type:'volume',Source:this.volume(agent.id,role),Target:'/'+role,ReadOnly:false})),...directories.map(g=>({Type:'bind',Source:g.path,Target:g.path,ReadOnly:g.access==='read',BindOptions:{Propagation:'rprivate',NonRecursive:true}}))],
  }}
  let created:any
  try{created=await this.request('POST','/containers/create?name='+name,body)}catch(e){
   if(!(e instanceof EngineError)||e.status!==409)throw e
   const existing=this.parse(await this.request('GET',`/containers/${name}/json`))
   if(existing.agentId!==agent.id||existing.boot!==intent.boot||existing.generation!==intent.generation||existing.revision!==intent.revision)throw Error('worker_ownership_conflict')
   if(existing.running)return
   created={Id:existing.id}
  }
  if(!/^[0-9a-f]{64}$/.test(created.Id))throw Error('worker_ownership_conflict')
  this.parse(await this.request('GET',`/containers/${created.Id}/json`))
  await this.request('PUT',`/containers/${created.Id}/archive?path=/control`,grantArchive({...grant as object,...(proof?{filesystemProof:proof,...(extended?{workspaceRoots:roots}:{})}:{})}))
  await this.request('POST',`/containers/${created.Id}/start`)
 }
}
