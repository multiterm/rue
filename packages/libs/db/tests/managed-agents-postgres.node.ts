import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto'
import {and,eq} from 'drizzle-orm'
import {createPostgresDatabase,type RuePostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {createPostgresWorkerRepository} from '../src/postgres/workers.ts'
import {createPostgresTerminalPairingRepository} from '../src/postgres/terminal-pairing.ts'
import {createPostgresMcpRepository} from '../src/postgres/mcp.ts'
import {createPostgresManagedAgentRepository} from '../src/postgres/managed-agents.ts'
import {managedAgents,managedOperations,terminalConnections,mcpProfiles,sessions,providerKeys,providerKeyGrants,workers,projectBindings} from '../src/postgres/schema.ts'
import {workerHealthSchema} from '../../../apps/core/src/storage/workers.ts'
import {managedCreateSchema,managedChangeSchema,managedReportSchema} from '../../../apps/core/src/storage/managed-agents.ts'
import {mcpProfileSchema} from '../../../apps/core/src/storage/mcp.ts'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL
const oldImage='sha256:'+'a'.repeat(64),newImage='sha256:'+'b'.repeat(64)
const health={version:'1.0.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,freeMemoryBytes:1000,cpus:2,capabilities:['host-health-v1','managed-mcp-v1','managed-filesystem-v1','managed-agent-upgrade-v1'],runtimeImage:oldImage,runtimeReleases:[{image:newImage,piVersion:'1.2.3',createdAt:1}]}
const config={provider:'openai',model:'model',permission:'coding',mounts:[],shareToolOutput:false,shareThinking:false}
const profile={name:'Tools',command:'node',args:['tool.js'],environment:{TOKEN:'fixture-private-secret',MODE:'safe'},acknowledgeTools:true}
type Tx=Parameters<Parameters<RuePostgresDatabase['transaction']>[0]>[0]

test('PostgreSQL managed lifecycle and atomic MCP revocation',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const db=pool.db,now=Date.now(),key=randomBytes(32)
  const codec={
   encrypt(scope:string[],value:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(scope)));const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64')},
   decrypt(scope:string[],value:string){const data=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAAD(Buffer.from(JSON.stringify(scope)));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8')},
  }
  let stopAgent:(tx:Tx,owner:string,id:string,revision:number,now:number)=>Promise<{id:string}>,failStop=false
  const worker=createPostgresWorkerRepository(db,raw=>workerHealthSchema.parse(raw))
  const mcp=createPostgresMcpRepository(db,{codec,parseProfile:raw=>mcpProfileSchema.parse(raw),stopAgent:(...args)=>stopAgent(...args)})
  const store=createPostgresManagedAgentRepository(db,{mcp,worker,codec,parseCreate:raw=>managedCreateSchema.parse(raw),parseChange:raw=>managedChangeSchema.parse(raw),parseReport:raw=>managedReportSchema.parse(raw),runtimeStatus:health=>{try{const version=JSON.parse(health??'{}').status?.piVersion;return typeof version==='string'?{piVersion:version}:null}catch{return null}},filesystemCapability:c=>c.filesystem?.directories.length?'managed-filesystem-v1':undefined})
  stopAgent=async(tx,owner,id,revision,now)=>{const result=await store.changeInTransaction(tx,owner,id,{requestId:randomUUID(),expectedRevision:revision,action:'stop'},now);if(failStop)throw Error('injected_stop_failure');return result.agent}
  async function fixture(){
   const owner=randomUUID(),created=await worker.create(owner,'Host',randomUUID(),now),instance=randomUUID()
   const lease=await worker.connect(created.worker.id,created.secret!,instance,now)
   await worker.heartbeat(created.worker.id,created.secret!,instance,lease.generation,health,now)
   return {owner,workerId:created.worker.id,auth:{id:created.worker.id,secret:created.secret!,instance,generation:lease.generation},input:{requestId:randomUUID(),workerId:created.worker.id,name:'Agent',acknowledgeExecution:true,config}}
  }
  await t.test('concurrent creation is idempotent, owner-isolated and creates one linked conversation',async()=>{
   const f=await fixture(),results=await Promise.all(Array.from({length:6},()=>store.create(f.owner,f.input,now)))
   assert.equal(new Set(results.map(r=>r.agent.id)).size,1)
   assert.equal((await db.select().from(sessions).where(eq(sessions.ownerSubject,f.owner))).length,1)
   assert.equal((await db.select().from(managedOperations).where(eq(managedOperations.ownerSubject,f.owner))).length,1)
   await assert.rejects(store.create(f.owner,{...f.input,name:'different'},now),/managed_request_conflict/)
   await assert.rejects(store.create('other-owner',f.input,now),/worker_not_found/)
   const visible=JSON.stringify(await store.list(f.owner));assert.equal(visible.includes('encryptedGrant'),false);assert.equal(visible.includes('tokenHash'),false)
  })
  await t.test('stop/resume fences old grants, CAS has one winner and preserves session identity',async()=>{
   const f=await fixture(),created=await store.create(f.owner,f.input,now),a=created.agent
   await db.update(managedAgents).set({grantRevision:1,grantGeneration:1,encryptedGrant:'fixture-grant'}).where(eq(managedAgents.id,a.id))
   const changes=await Promise.allSettled(Array.from({length:5},()=>store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:1,action:'stop'},now+1)))
   assert.equal(changes.filter(r=>r.status==='fulfilled').length,1)
   const [stopped]=await db.select().from(managedAgents).where(eq(managedAgents.id,a.id));assert.equal(stopped!.grantRevision,null);assert.equal(stopped!.encryptedGrant,null)
   const resumed=await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:2,action:'resume'},now+2)
   assert.equal(resumed.agent.sessionId,a.sessionId);assert.equal(resumed.agent.connectionId,a.connectionId);assert.equal(resumed.agent.revision,3)
   assert.equal((await db.select().from(managedAgents).where(eq(managedAgents.id,a.id)))[0]!.grantRevision,null)
   assert.equal((await store.operations(f.owner,a.id)).filter(o=>o.status==='pending').length,1)
  })
  await t.test('destroy revokes terminal/provider access and purge requires explicit consent',async()=>{
   const f=await fixture(),{agent:a}=await store.create(f.owner,f.input,now)
   await db.insert(providerKeys).values({ownerSubject:f.owner,provider:'anthropic',revision:1,encryptedKey:'fixture'})
   await db.insert(providerKeyGrants).values({ownerSubject:f.owner,provider:'anthropic',targetType:'terminal',targetId:a.connectionId!})
   await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:1,action:'destroy'},now+1)
   assert.equal((await db.select().from(providerKeyGrants).where(eq(providerKeyGrants.ownerSubject,f.owner))).length,0)
   const [host]=await db.select().from(terminalConnections).where(eq(terminalConnections.id,a.connectionId!));assert.equal(host!.revokedAt,now+1);assert.equal(host!.remoteEnabled,0)
   await assert.rejects(store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:2,action:'purge'},now+2),/managed_purge_requires_destroy_and_consent/)
   const purged=await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:2,action:'purge',acknowledgePurge:true},now+2)
   assert.equal(purged.agent.purgeRequested,true)
   assert.equal((await db.select().from(sessions).where(eq(sessions.id,a.sessionId!))).length,1)
  })
  await t.test('configuration requires filesystem consent and upgrades preserve in-flight grants until replacement',async()=>{
   const f=await fixture(),{agent:a}=await store.create(f.owner,f.input,now)
   const change={requestId:randomUUID(),expectedRevision:1,action:'configure',acknowledgeExecution:true,config:{...config,filesystem:{version:1,directories:[{path:'/Volumes/MOTHERSHIP/test',access:'read'}]}}}
   await assert.rejects(store.change(f.owner,a.id,change,now),/managed_filesystem_consent_required/)
   const configured=await store.change(f.owner,a.id,{...change,acknowledgeFilesystem:true},now);assert.equal(configured.agent.desired,'stopped')
   await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:2,action:'resume'},now)
   await db.update(managedAgents).set({grantRevision:3,grantGeneration:1,encryptedGrant:'fixture-grant'}).where(eq(managedAgents.id,a.id))
   const upgraded=await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:3,action:'upgrade',acknowledgeExecution:true,image:newImage,expectedImage:oldImage,piVersion:'1.2.3'},now)
   assert.equal(upgraded.agent.runtimeUpdateState,'updating')
   assert.equal((await db.select().from(managedAgents).where(eq(managedAgents.id,a.id)))[0]!.grantRevision,3)
   const stopped=await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:4,action:'stop'},now)
   assert.equal(stopped.agent.runtimeUpdateState,'cancelled');assert.equal(stopped.agent.runtimeImage,oldImage)
  })
  await t.test('concurrent grants reuse one encrypted token; boot rotation and stop/resume fence old credentials',async()=>{
   const f=await fixture(),{agent:a}=await store.create(f.owner,f.input,now),pairing=createPostgresTerminalPairingRepository(db)
   const results=await Promise.all(Array.from({length:6},()=>store.grant(f.auth,a.id,1,now)))
   assert.equal(new Set(results.map(r=>r.token)).size,1)
   const first=results[0]!,[saved]=await db.select().from(managedAgents).where(eq(managedAgents.id,a.id))
   assert.notEqual(saved!.encryptedGrant,first.token)
   assert.equal(codec.decrypt([f.owner,'managed-agent',a.id],saved!.encryptedGrant!),first.token)
   assert.equal((await pairing.authenticate(first.token,first.id,now)).ownerSubject,f.owner)
   const next=await store.grant(f.auth,a.id,1,now,2);assert.notEqual(next.token,first.token)
   await assert.rejects(pairing.authenticate(first.token,first.id,now),/invalid_terminal_credential/)
   await assert.rejects(store.grant(f.auth,a.id,1,now,1),/managed_boot_fenced/)
   await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:1,action:'stop'},now+1)
   await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:2,action:'resume'},now+2)
   await assert.rejects(pairing.authenticate(next.token,next.id,now+2),/invalid_terminal_credential/)
   const resumed=await store.grant(f.auth,a.id,3,now+2)
   assert.notEqual(resumed.token,next.token);assert.equal(resumed.sessionId,first.sessionId)
   await assert.rejects(store.grant({...f.auth,instance:randomUUID()},a.id,3,now+2),/worker_session_fenced/)
  })
  await t.test('grant and snapshot deadlines cannot outlive a shortened project authorization',async()=>{
   const f=await fixture(),{agent:a}=await store.create(f.owner,f.input,now),id=randomUUID()
   await db.insert(projectBindings).values({id,ownerSubject:f.owner,tenancyOrigin:'https://identity.example',organizationId:'org',projectId:'project',keyId:'key',keyHash:'fixture',encryptedKey:'fixture-ciphertext',scopes:'[]',expiresAt:now+60000,createdAt:now,verifiedAt:now,authorizedUntil:now+5000})
   await db.update(workers).set({projectBindingId:id}).where(eq(workers.id,f.workerId))
   assert.equal((await store.grant(f.auth,a.id,1,now)).expiresAt,now+5000)
   assert.equal((await store.snapshot(f.auth,now)).expiresAt,now+5000)
   await assert.rejects(store.grant(f.auth,a.id,1,now+5000),/worker_project_fenced/)
   await assert.rejects(store.create(f.owner,{...f.input,requestId:randomUUID()},now+5000),/worker_project_fenced/)
  })
  await t.test('worker reports complete operations and purge only after explicit authorization',async()=>{
   const f=await fixture(),other=await fixture(),{agent:a}=await store.create(f.owner,f.input,now)
   await store.grant(f.auth,a.id,1,now)
   await assert.rejects(store.report(other.auth,a.id,{revision:1,state:'running',error:null},now),/managed_agent_not_found/)
   assert.equal((await store.report(f.auth,a.id,{revision:1,state:'running',error:null},now)).observed,'running')
   assert.equal((await store.operations(f.owner,a.id))[0]!.status,'succeeded')
   const snapshot=await store.snapshot(f.auth,now)
   assert.equal(snapshot.agents.length,1);assert.equal(snapshot.agents[0]!.grantRevision,1)
   assert.equal(JSON.stringify(snapshot).includes('encryptedGrant'),false)
   await assert.rejects(store.report(f.auth,a.id,{revision:1,state:'purged',error:null},now),/managed_purge_not_authorized/)
   await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:1,action:'destroy'},now+1)
   await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:2,action:'purge',acknowledgePurge:true},now+2)
   const removed=await store.report(f.auth,a.id,{revision:3,state:'purged',error:null},now+3)
   assert.equal(removed.purgedAt,now+3);assert.equal(removed.sessionId,null);assert.equal(removed.connectionId,null)
   assert.equal((await store.snapshot(f.auth,now+3)).agents.length,0)
   assert.equal((await db.select().from(sessions).where(eq(sessions.id,a.sessionId!))).length,0)
  })
  await t.test('single-agent upgrade requires fresh runtime verification; failed rollback stops the agent',async()=>{
   const f=await fixture(),{agent:a}=await store.create(f.owner,f.input,now)
   await store.grant(f.auth,a.id,1,now)
   await store.change(f.owner,a.id,{requestId:randomUUID(),expectedRevision:1,action:'upgrade',acknowledgeExecution:true,image:newImage,expectedImage:oldImage,piVersion:'1.2.3'},now+1)
   await store.grant(f.auth,a.id,2,now+1)
   assert.equal((await store.report(f.auth,a.id,{revision:2,state:'running',error:null},now+2)).observed,'starting')
   const rollback=await store.report(f.auth,a.id,{revision:2,state:'failed',error:'runtime_failed'},now+3)
   assert.equal(rollback.runtimeUpdateState,'rolling_back');assert.equal(rollback.runtimeImage,oldImage);assert.equal(rollback.revision,3)
   await store.grant(f.auth,a.id,3,now+4)
   const stopped=await store.report(f.auth,a.id,{revision:3,state:'failed',error:'runtime_failed'},now+5)
   assert.equal(stopped.runtimeUpdateState,'failed');assert.equal(stopped.desired,'stopped')
   assert.equal((await db.select().from(managedAgents).where(eq(managedAgents.id,a.id)))[0]!.encryptedGrant,null)
  })
  await t.test('MCP metadata never returns credentials and idempotency compares canonical environments',async()=>{
   const owner=randomUUID(),id=randomUUID()
   const results=await Promise.all(Array.from({length:5},()=>mcp.create(owner,id,profile,now)))
   assert.equal(new Set(results.map(r=>r.id)).size,1)
   assert.equal((await mcp.create(owner,id,{...profile,environment:{MODE:'safe',TOKEN:'fixture-private-secret'}},now)).id,id)
   const [row]=await db.select().from(mcpProfiles).where(eq(mcpProfiles.id,id));assert.ok(row!.encryptedEnv);assert.equal(row!.encryptedEnv!.includes(profile.environment.TOKEN),false)
   assert.equal(JSON.stringify(await mcp.list(owner)).includes(profile.environment.TOKEN),false)
   assert.deepEqual((await db.transaction(tx=>mcp.resolveInTransaction(tx,owner,[id])))[0]!.environment,profile.environment)
   await assert.rejects(db.transaction(tx=>mcp.resolveInTransaction(tx,'other-owner',[id])),/mcp_profile_unavailable/)
   await assert.rejects(mcp.create('other-owner',id,profile,now),/mcp_request_conflict/)
   await assert.rejects(mcp.create(owner,id,{...profile,environment:{TOKEN:'different'}},now),/mcp_request_conflict/)
  })
  await t.test('MCP profile quota is atomic across concurrent requests',async()=>{
   const owner=randomUUID()
   await db.insert(mcpProfiles).values(Array.from({length:31},()=>({id:randomUUID(),ownerSubject:owner,name:'existing',command:'node',args:'[]',environmentNames:'[]',createdAt:now})))
   const results=await Promise.allSettled(Array.from({length:6},()=>mcp.create(owner,randomUUID(),profile,now)))
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await mcp.list(owner)).length,32)
  })
  await t.test('MCP revocation rolls back partial stops on failure, then atomically removes secrets and bindings',async()=>{
   const f=await fixture(),id=randomUUID(),p=await mcp.create(f.owner,id,profile,now)
   const a=await store.create(f.owner,{...f.input,config:{...config,mcp:[id]}},now)
   failStop=true
   await assert.rejects(mcp.remove(f.owner,id,p.revision,now+1),/injected_stop_failure/)
   failStop=false
   assert.equal((await store.list(f.owner))[0]!.desired,'running');assert.equal((await mcp.list(f.owner)).length,1)
   assert.equal((await db.select().from(managedOperations).where(and(eq(managedOperations.agentId,a.agent.id),eq(managedOperations.action,'stop')))).length,0)
   const removed=await mcp.remove(f.owner,id,p.revision,now+2);assert.equal(removed.agents.length,1)
   const [saved]=await db.select().from(managedAgents).where(eq(managedAgents.id,a.agent.id));assert.equal(saved!.desired,'stopped');assert.equal(JSON.parse(saved!.config).mcp,undefined)
   const [erased]=await db.select().from(mcpProfiles).where(eq(mcpProfiles.id,id));assert.equal(erased!.encryptedEnv,null);assert.equal(erased!.environmentNames,'[]')
   await assert.rejects(db.transaction(tx=>mcp.resolveInTransaction(tx,f.owner,[id])),/mcp_profile_unavailable/)
   assert.deepEqual((await mcp.remove(f.owner,id,p.revision,now+3)).agents,[])
  })
 }finally{await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
