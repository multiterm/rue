import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {reconcile} from '../packages/apps/worker/src/reconcile.ts'
import {AgentContainers} from '../packages/apps/worker/src/containers.ts'
const oldImage='sha256:'+'a'.repeat(64),newImage='sha256:'+'b'.repeat(64)
function agent(id=randomUUID()){return {id,workerId:randomUUID(),sessionId:'session',connectionId:'connection',name:'Agent',desired:'running',revision:1,createdAt:1,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false},observed:'running',observedRevision:1,observedGeneration:1,observedAt:1,error:null,busy:false,connected:true,grantRevision:1,grantGeneration:1,grantBoot:1}}
test('reconciler updates only the selected idle agent, and preflights before touching its old container',async()=>{
 const target={...agent(),revision:2,runtimeImage:newImage,previousRuntimeImage:oldImage},other=agent(),containers=[{id:'target',agentId:target.id,generation:1,revision:1,boot:1,running:true},{id:'other',agentId:other.id,generation:1,revision:1,boot:1,running:true}]
 const events=[],intents=new Map(),ports={authorized:()=>true,inventory:async()=>containers,load:id=>intents.get(id),save:(id,value)=>intents.set(id,value),prepare:async a=>events.push(['prepare',a.id]),remove:async c=>events.push(['remove',c.id]),start:async a=>events.push(['start',a.id]),report:async(a,state)=>events.push(['report',a.id,state]),purge:async()=>assert.fail('No purge during update')}
 await reconcile({generation:1,desired:'active',agents:[{...target,busy:true},other]},ports,2,100)
 assert.deepEqual(events,[['report',other.id,'running']]);events.length=0
 await reconcile({generation:1,desired:'active',agents:[target,other]},ports,2,100)
 assert.deepEqual(events,[['prepare',target.id],['remove','target'],['start',target.id],['report',target.id,'starting'],['report',other.id,'running']])
 assert.equal(intents.size,1);assert.equal(intents.get(target.id).revision,2)
 events.length=0;ports.prepare=async()=>{throw Error('image unavailable')}
 await reconcile({generation:1,desired:'active',agents:[target,other]},ports,2,100)
 assert.deepEqual(events,[['report',target.id,'failed'],['report',other.id,'running']])
})
test('mixed-image container ownership stays per-agent; updates reuse private volumes and leave another agent untouched',async()=>{
 const worker=randomUUID(),target=agent(),other=agent(),manager=new AgentContainers('unused',worker,'https://rue.test',oldImage,()=>{}),records=new Map(),calls=[]
 const imageConfig=image=>({Labels:{'io.rue.agent-runtime':'1','io.rue.pi-sdk':image===newImage?'0.87.1':'0.85.1'},Entrypoint:[image===newImage?'guardian-new':'guardian-old'],Env:[image===newImage?'VERSION=new':'VERSION=old']})
 let serial=0
 manager.request=async(method,path,body)=>{
  calls.push({method,path,body})
  if(path.startsWith('/images/')){const image=path.slice(8,-5);return {Id:image,Config:imageConfig(image)}}
  if(path.startsWith('/volumes/')){const name=path.slice(9),role=name.split('-').at(-1),a=[target,other].find(a=>name.includes(a.id));return {Name:name,Driver:'local',Scope:'local',Options:{},Labels:{'io.rue.scope':manager.scope,'io.rue.agent':a.id,'io.rue.role':role},Mountpoint:'/var/lib/docker/volumes/'+name+'/_data'}}
  if(path.startsWith('/containers/create?')){const id=(++serial).toString(16).padStart(64,'0');records.set(id,{Id:id,Image:body.Image,State:{Running:false},Config:{...body,...imageConfig(body.Image),Labels:body.Labels},HostConfig:body.HostConfig,Mounts:body.HostConfig.Mounts.map(m=>({Type:'volume',Name:m.Source,Destination:m.Target,RW:true}))});return {Id:id}}
  if(path.startsWith('/containers/json?'))return [...records.keys()].map(Id=>({Id}))
  const id=path.split('/')[2].split('?')[0],record=records.get(id)
  if(path.endsWith('/json'))return record
  if(path.endsWith('/start'))record.State.Running=true
  if(path.includes('/stop?'))record.State.Running=false
  if(method==='DELETE')records.delete(id)
  return {}
 }
 manager.configureAgents([target,other]);const boot={generation:1,revision:1,boot:1,attempts:1,retryAt:1}
 await manager.start(target,boot,{});await manager.start(other,boot,{})
 const before=await manager.inventory(),previous=before.find(c=>c.agentId===target.id),untouched=JSON.stringify(records.get(before.find(c=>c.agentId===other.id).id)),mounts=records.get(previous.id).HostConfig.Mounts
 const update={...target,revision:2,runtimeImage:newImage,previousRuntimeImage:oldImage,runtimeUpdateState:'updating',runtimeUpdateVersion:'0.87.1'}
 manager.configureAgents([update,other]);calls.length=0
 await manager.prepare(update);await manager.remove(previous);await manager.start(update,{...boot,revision:2},{})
 const after=await manager.inventory(),updated=records.get(after.find(c=>c.agentId===target.id).id),otherRecord=records.get(after.find(c=>c.agentId===other.id).id)
 assert.equal(updated.Image,newImage);assert.equal(otherRecord.Image,oldImage)
 assert.deepEqual(updated.HostConfig.Mounts,mounts);assert.equal(JSON.stringify(otherRecord),untouched)
 assert.deepEqual(calls.filter(c=>c.method==='DELETE').map(c=>c.path),[`/containers/${previous.id}?v=0`])
 assert.equal(calls.some(c=>c.path.includes('/images/create')),false,'never pull an image')
 otherRecord.Image=newImage;await assert.rejects(()=>manager.inventory(),/ownership_conflict/);otherRecord.Image=oldImage
 updated.HostConfig.Privileged=true;await assert.rejects(()=>manager.inventory(),/ownership_conflict/);updated.HostConfig.Privileged=false
 updated.Config.Entrypoint=['guardian-old'];await assert.rejects(()=>manager.inventory(),/ownership_conflict/)
})
