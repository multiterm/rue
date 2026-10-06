import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {WebSocket} from 'ws'
import {SocketRouter} from '../../src/server/socket-router.js'
import {installWorkerSocket} from '../../src/server/worker-socket.js'
import {installTerminalSocket} from '../../src/server/terminal-socket.js'
import type {Database} from 'better-sqlite3'
import {createPostgresDatabase,migratePostgresDatabase,createPostgresTerminalRelayRepository} from '@multiterm/rue-db/postgres'
import {createPostgresSessionServices} from '../../src/server/postgres-session-services.js'
import {createApp} from '../../src/server/app.js'
import {postgresRelayOptions} from '../../src/storage/relay-health.js'
import type {ServerContext} from '../../src/server/context.js'
import {ConfigSchema} from '../../src/config/index.js'
import {Bus} from '../../src/bus/index.js'
import {ProjectAuthority} from '../../src/server/project-authority.js'
import {tenancyVerifier} from '../../src/server/tenancy-verifier.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL managed execution HTTP uses owner and worker proofs without SQLite',{skip:!adminUrl},async t=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false,sqliteAccess=0
 const enrollmentToken='tnk_'+randomBytes(32).toString('base64url');let enrollmentRevoked=false
 const identity=t.mock.method(globalThis,'fetch',async(url,init)=>{
  const endpoint=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url)
  const token=JSON.parse(String(init?.body)).token
  if(endpoint.href==='https://tenancy.test/v1/service/rue/keys/verify')return token===enrollmentToken&&!enrollmentRevoked?Response.json({key:{id:'fixture-key',name:'Fixture',service:'rue',owner:{type:'self',subject:'enrolled-owner'},grants:['rue:hosts:read','rue:hosts:enroll','rue:agents:execute'],createdAt:Date.now(),expiresAt:Date.now()+3600000,revokedAt:null}}):Response.json({error:'TENANCY_API_KEY_INVALID'},{status:401})
  assert.equal(endpoint.origin,'https://identity.test')
  return ['owner','other'].includes(token)?Response.json({token:{subject:token,principalType:'user'}}):new Response(null,{status:401})
 })
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:8});await migratePostgresDatabase(pool.db)
  const services=createPostgresSessionServices(pool.db,()=>Buffer.alloc(32,11)),store=services.execution
  const ctx:ServerContext={db:new Proxy({} as Database,{get(){sqliteAccess++;throw Error('SQLite forbidden')}}),sessions:services,config:ConfigSchema.parse({keyname:{enabled:true,apiUrl:'https://identity.test'}}),bus:new Bus()}
  const app=createApp({ctx,terminalPairing:true,managedWorkers:true,managedAgents:true})
  const request=(path:string,method='GET',body?:unknown,token='owner')=>app.request(path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)})
  const worker=await store.workers.create('owner','Fixture host',randomUUID()),instance=randomUUID(),lease=await store.workers.connect(worker.worker.id,worker.secret!,instance)
  const auth={instance,generation:lease.generation}
  await store.workers.heartbeat(worker.worker.id,worker.secret!,instance,lease.generation,{version:'1.0.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,freeMemoryBytes:1000000,cpus:2,capabilities:['host-health-v1','managed-mcp-v1','managed-compact-v1','managed-runtime-rollout-v1'],runtimeImage:'sha256:'+'a'.repeat(64)})
  const profile=randomUUID(),profileInput={expectedOwnerSubject:'owner',name:'Tools',command:'node',args:['tool.js'],environment:{TOKEN:'fixture-mcp-secret'},acknowledgeTools:true}
  let agentId='',connectionId='',token='',runtimeInstance=randomUUID()
  await t.test('concurrent creation is idempotent and owner-scoped; MCP metadata has no secrets',async()=>{
   const profileResponse=await request('/mcp/'+profile,'PUT',profileInput);assert.equal(profileResponse.status,201);assert.equal((await profileResponse.text()).includes('fixture-mcp-secret'),false)
   const input={requestId:randomUUID(),workerId:worker.worker.id,name:'Agent',acknowledgeExecution:true,config:{provider:'openai',model:'fixture-model',permission:'coding',mounts:[],shareToolOutput:false,shareThinking:false,mcp:[profile]}}
   assert.equal((await request('/managed-agents','POST',input,'other')).status,404)
   const responses=await Promise.all(Array.from({length:5},()=>request('/managed-agents','POST',input)))
   for(const response of responses)assert.equal(response.status,201)
   const bodies=await Promise.all(responses.map(r=>r.json())) as Array<{agent:{id:string}}>
   agentId=bodies[0]!.agent.id;assert.equal(new Set(bodies.map(b=>b.agent.id)).size,1)
   assert.deepEqual(await (await request('/managed-agents','GET',undefined,'other')).json(),{agents:[]})
   assert.equal((await request('/managed-agents/'+agentId+'/operations','GET',undefined,'other')).status,404)
   const listed=await (await request('/workers')).json() as {workers:Array<{managedAgentCount:number}>};assert.equal(listed.workers[0]!.managedAgentCount,1)
  })
  await t.test('worker grants are private and snapshots, reports and compaction polls use PostgreSQL',async()=>{
   const root='/worker-client/'+worker.worker.id+'/agents'
   assert.equal((await request(root+'/snapshot','POST',auth)).status,401)
   const response=await request(root+'/'+agentId+'/grant','POST',{...auth,revision:1},worker.secret!);assert.equal(response.status,200)
   const grant=await response.json() as {id:string;token:string;mcp:Array<{environment:{TOKEN:string}}>}
   connectionId=grant.id;token=grant.token;assert.equal(grant.mcp[0]!.environment.TOKEN,'fixture-mcp-secret')
   const snapshot=await request(root+'/snapshot','POST',auth,worker.secret!);assert.equal(snapshot.status,200);const body=await snapshot.text();assert.equal(body.includes(token),false);assert.equal(body.includes('fixture-mcp-secret'),false)
   assert.equal((await request(root+'/'+agentId+'/report','POST',{...auth,report:{revision:1,boot:1,state:'running',error:null}},worker.secret!)).status,200)
   assert.deepEqual(await (await request(root+'/compactions','POST',auth,worker.secret!)).json(),{commands:[]})
   const control=await request('/terminal-client/connections/'+connectionId+'/runtime-control','GET',undefined,token)
   assert.equal(control.status,200);assert.equal((await control.json() as {approved:boolean}).approved,false)
   const relay=createPostgresTerminalRelayRepository(pool!.db,postgresRelayOptions);await relay.attach(token,connectionId,runtimeInstance,undefined,2)
   assert.deepEqual(await (await request('/terminal-client/'+connectionId+'/compactions/poll','POST',{instance:runtimeInstance},token)).json(),{commands:[]})
   assert.deepEqual(await (await request('/managed-agents/'+agentId+'/compactions')).json(),{commands:[]})
  })
  await t.test('bearer-only runtime control preserves human approval and cancels revoked preflight jobs',async()=>{
   const grantPath='/runtime-rollouts/agents/'+agentId+'/grant',terminalPath='/terminal-client/connections/'+connectionId+'/runtime-control'
   const before=await (await request(grantPath)).json() as {revision:number;expiresAt:number|null}
   assert.equal(before.revision,0);assert.equal(before.expiresAt,null)
   const input={requestId:randomUUID(),expectedWorkerRevision:0,expectedImage:'sha256:'+'a'.repeat(64),image:'sha256:'+'b'.repeat(64),acknowledgeHostExecution:true}
   assert.equal((await request(terminalPath+'/rollouts','POST',input,token)).status,403)
   assert.equal((await request(grantPath,'PUT',{expectedOwnerSubject:'owner',expectedRevision:0,enabled:true,expectedAgentRevision:1,expectedWorkerId:worker.worker.id,expectedConnectionId:connectionId,expiresInSeconds:3600,acknowledgeHostControl:true})).status,200)
   const metadata=await (await request(terminalPath,'GET',undefined,token)).json() as {approved:boolean;canSubmit:boolean}
   assert.equal(metadata.approved,true);assert.equal(metadata.canSubmit,true)
   const submitted=await request(terminalPath+'/rollouts','POST',input,token);assert.equal(submitted.status,202)
   const job=await submitted.json() as {id:string;phase:string};assert.equal(job.phase,'preflight')
   assert.equal((await request(terminalPath+'/rollouts/'+job.id,'GET',undefined,token)).status,200)
   assert.equal((await request('/runtime-rollouts/'+job.id,'GET',undefined,'other')).status,404)
   assert.equal((await request(grantPath,'PUT',{expectedOwnerSubject:'owner',expectedRevision:1,enabled:false})).status,200)
   assert.equal((await (await request('/runtime-rollouts/'+job.id)).json() as {phase:string}).phase,'failed')
   assert.equal((await request(terminalPath+'/rollouts/'+job.id,'GET',undefined,token)).status,403)
   assert.deepEqual(await (await request('/worker-client/'+worker.worker.id+'/runtime-rollouts/poll','POST',auth,worker.secret!)).json(),{job:null})
  })
  await t.test('MCP removal atomically stops affected agents and fences old grants',async()=>{
   const removed=await request('/mcp/'+profile,'DELETE',{expectedRevision:1});assert.equal(removed.status,200)
   const result=await removed.json() as {stoppedAgents:string[]};assert.deepEqual(result.stoppedAgents,[agentId])
   const stopped=await store.managed.get('owner',agentId);assert.equal(stopped.desired,'stopped');assert.equal(stopped.revision,2);assert.equal(stopped.config.mcp,undefined)
   assert.equal((await request('/worker-client/'+worker.worker.id+'/agents/'+agentId+'/grant','POST',{...auth,revision:1},worker.secret!)).status,409)
   assert.ok((await request('/terminal-client/'+connectionId+'/compactions/poll','POST',{instance:runtimeInstance},token)).status>=400)
   const row=(await pool!.sql`SELECT encrypted_env FROM mcp_profiles WHERE id=${profile}`)[0]!;assert.equal(row.encrypted_env,null)
   const mutations=ctx.bus.historySince(0).filter(e=>['managed-agent.updated','worker.control.changed','mcp.updated'].includes(e.type));assert.ok(mutations.length>0)
   for(const event of mutations)assert.equal((event.payload as {ownerSubject:string}).ownerSubject,'owner')
   assert.equal((await request('/workers/'+worker.worker.id,'PATCH',{action:'drain',expectedRevision:0})).status,200)
  })
  await t.test('real worker WebSocket awaits PostgreSQL authentication, heartbeat and revocation',async()=>{
   const server=createServer(),router=new SocketRouter(server),stop=installWorkerSocket(router,ctx)
   let socket:WebSocket|undefined
   try{
    const listening=once(server,'listening');server.listen(0,'127.0.0.1');await listening
    const address=server.address();assert.ok(address&&typeof address==='object')
    socket=new WebSocket(`ws://127.0.0.1:${address.port}/worker-client/socket`);await once(socket,'open',{signal:AbortSignal.timeout(3000)})
    const frame=async()=>JSON.parse(String((await once(socket!,'message',{signal:AbortSignal.timeout(3000)}))[0]))
    const ready=frame();socket.send(JSON.stringify({type:'authenticate',protocol:1,id:worker.worker.id,token:worker.secret,instance}))
    const accepted=await ready;assert.equal(accepted.type,'ready');assert.equal(accepted.lease.worker.ownerSubject,'owner')
    const ack=frame(),requestId=randomUUID();socket.send(JSON.stringify({type:'heartbeat',requestId,generation:accepted.lease.generation,health:{version:'1.0.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,freeMemoryBytes:1000000,cpus:2,capabilities:['host-health-v1']}}))
    const heartbeat=await ack;assert.equal(heartbeat.type,'heartbeat_ack');assert.equal(heartbeat.requestId,requestId);assert.equal(heartbeat.lease.worker.health.acceptingWork,false)
    const fenced=frame(),closed=once(socket,'close',{signal:AbortSignal.timeout(3000)})
    assert.equal((await request('/workers/'+worker.worker.id,'PATCH',{action:'revoke',expectedRevision:1})).status,200)
    assert.equal((await fenced).code,'invalid_worker_credential');await closed
   }finally{socket?.terminate();stop();router.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
   assert.equal(ctx.bus.listenerCount(),0)
  })
  await t.test('terminal pairing, queue execution, mirrored history and real WebSocket preserve the protocol',async()=>{
   const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('hex')
   const started=await request('/terminal-client/requests','POST',{challenge,piSessionId:randomUUID()});assert.equal(started.status,201)
   const {requestId}=await started.json() as {requestId:string}
   const approval=await request('/terminal/requests/'+requestId+'/approve','POST',{expectedOwnerSubject:'owner',botName:'Fixture computer'});assert.equal(approval.status,200)
   const {code}=await approval.json() as {code:string}
   const exchanged=await request('/terminal-client/exchange','POST',{requestId,verifier,code});assert.equal(exchanged.status,200)
   const connection=await exchanged.json() as {id:string;token:string;sessionId:string},root='/terminal-client/connections/'+connection.id,runtime=randomUUID()
   assert.equal((await request('/terminal-client/activate','POST',{confirmOwnerSubject:'other'},connection.token)).status,401)
   assert.equal((await request('/terminal-client/activate','POST',{confirmOwnerSubject:'owner'},connection.token)).status,200)
   assert.equal((await request('/terminal/computers/'+connection.id,'PATCH',{expectedOwnerSubject:'owner',expectedRevision:0,name:'Fixture computer',remoteEnabled:true})).status,200)
   assert.equal((await request(root+'/relay/attach','POST',{instance:runtime,protocol:2},connection.token)).status,200)
   assert.equal((await request(root+'/authority','GET',undefined,connection.token)).status,404)
   assert.equal((await request('/session/'+connection.sessionId+'/message','POST',{text:'fixture prompt',requestId:randomUUID()})).status,200)
   const queued=await (await request('/terminal/computers/'+connection.id+'/queue')).json() as {messages:Array<{id:string}>};assert.equal(queued.messages.length,1)
   assert.equal((await request('/terminal/computers/'+connection.id+'/queue','GET',undefined,'other')).status,404)
   const command=root+'/relay/commands/'+queued.messages[0]!.id
   for(const action of ['claim','start'])assert.equal((await request(command+'/'+action,'POST',{instance:runtime},connection.token)).status,200)
   assert.ok((await (await request(command+'/input','POST',{instance:runtime},connection.token)).text()).includes('fixture prompt'))
   assert.equal((await request(command+'/output','POST',{instance:runtime,version:1,text:'fixture reply',status:'completed'},connection.token)).status,200)
   const event={instance:runtime,eventId:randomUUID(),role:'assistant',text:'mirrored fixture',snapshot:{version:1,final:true}}
   assert.equal((await request(root+'/relay/mirror','POST',event,connection.token)).status,200)
   assert.equal((await request(root+'/relay/mirror','POST',event,connection.token)).status,200)
   const receipts=await (await request(root+'/receipts','GET',undefined,connection.token)).json() as {receipts:unknown[]};assert.equal(receipts.receipts.length,1)
   const usage={eventId:randomUUID(),provider:'openai',model:'fixture-model',credentialId:null,time:Date.now(),input:1,output:2,cacheRead:0,cacheWrite:0,costUsd:null}
   assert.equal((await request(root+'/relay/usage','POST',{instance:runtime,event:usage},connection.token)).status,200)
   const server=createServer(),router=new SocketRouter(server),stop=installTerminalSocket(server,ctx,req=>app.fetch(req),router)
   let socket:WebSocket|undefined,bad:WebSocket|undefined
   try{
    const listening=once(server,'listening');server.listen(0,'127.0.0.1');await listening
    const address=server.address();assert.ok(address&&typeof address==='object')
    const url=`ws://127.0.0.1:${address.port}/terminal-client/socket`,authenticate={type:'authenticate',id:connection.id,token:connection.token,instance:runtime}
    socket=new WebSocket(url);await once(socket,'open',{signal:AbortSignal.timeout(3000)})
    const frame=async()=>JSON.parse(String((await once(socket!,'message',{signal:AbortSignal.timeout(3000)}))[0]))
    const ready=frame();socket.send(JSON.stringify(authenticate));assert.equal((await ready).type,'ready')
    const response=frame();socket.send(JSON.stringify({type:'request',id:'1',path:'mirror',body:event}));const reply=await response
    assert.equal(reply.type,'response');assert.equal(reply.status,200);assert.equal(reply.id,'1')
    // Hold asynchronous authentication and send a second auth frame. The closed
    // socket must never install a late/duplicate bus subscription.
    const validate=services.terminal.relay.validateSocket;let release!:()=>void,entered!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve})
    services.terminal.relay.validateSocket=async(...args)=>{entered();await gate;return validate(...args)}
    try{
     bad=new WebSocket(url);await once(bad,'open',{signal:AbortSignal.timeout(3000)})
     const closed=once(bad,'close',{signal:AbortSignal.timeout(3000)})
     bad.send(JSON.stringify(authenticate));await Promise.race([started,new Promise<never>((_,reject)=>AbortSignal.timeout(3000).addEventListener('abort',()=>reject(Error('authentication did not start')),{once:true}))]);bad.send(JSON.stringify(authenticate));await closed
    }finally{services.terminal.relay.validateSocket=validate;release()}
    await validate(connection.token,connection.id,runtime);assert.equal(ctx.bus.listenerCount(),1)
    const closed=once(socket,'close',{signal:AbortSignal.timeout(3000)})
    assert.equal((await request(root,'DELETE',undefined,connection.token)).status,200);await closed
    assert.equal((await request(root,'GET',undefined,connection.token)).status,401)
   }finally{bad?.terminate();socket?.terminate();stop();router.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
   assert.equal(ctx.bus.listenerCount(),0)
  })
  await t.test('Tenancy-key enrollment is idempotent and revoked external proof fences a real worker socket',async()=>{
   ctx.projectAuthority=new ProjectAuthority(store.projects,tenancyVerifier('https://tenancy.test','v'.repeat(40)))
   const input={name:'Enrolled fixture host',requestId:randomUUID(),acknowledgeHostControl:true}
   const response=await request('/workers','POST',input,enrollmentToken);assert.equal(response.status,201)
   const enrolled=await response.json() as {worker:{id:string;ownerSubject:string;keyAuthorityId:string};secret:string}
   assert.equal(enrolled.worker.ownerSubject,'enrolled-owner')
   const retry=await request('/workers','POST',input,enrollmentToken);assert.equal(retry.status,200);assert.equal('secret' in await retry.json(),false)
   assert.equal((await request('/provider-keys','GET',undefined,enrollmentToken)).status,401)
   const server=createServer(),router=new SocketRouter(server),stop=installWorkerSocket(router,ctx);let socket:WebSocket|undefined
   try{
    const listening=once(server,'listening');server.listen(0,'127.0.0.1');await listening
    const address=server.address();assert.ok(address&&typeof address==='object')
    socket=new WebSocket(`ws://127.0.0.1:${address.port}/worker-client/socket`);await once(socket,'open',{signal:AbortSignal.timeout(3000)})
    const frame=async()=>JSON.parse(String((await once(socket!,'message',{signal:AbortSignal.timeout(3000)}))[0]))
    const ready=frame();socket.send(JSON.stringify({type:'authenticate',protocol:1,id:enrolled.worker.id,token:enrolled.secret,instance:randomUUID()}))
    const accepted=await ready;assert.equal(accepted.type,'ready');assert.ok(accepted.lease.expiresAt-accepted.lease.serverNow<=45000)
    enrollmentRevoked=true
    const fenced=frame(),closed=once(socket,'close',{signal:AbortSignal.timeout(3000)})
    socket.send(JSON.stringify({type:'heartbeat',requestId:randomUUID(),generation:accepted.lease.generation,health:{version:'1.0.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:false,freeMemoryBytes:1000000,cpus:2,capabilities:['host-health-v1']}}))
    assert.equal((await fenced).code,'worker_project_fenced');await closed
    assert.equal((await pool!.sql`SELECT lease_expires_at FROM workers WHERE id=${enrolled.worker.id}`)[0]!.lease_expires_at,null)
    assert.equal((await pool!.sql`SELECT encrypted_key FROM project_bindings WHERE id=${enrolled.worker.keyAuthorityId}`)[0]!.encrypted_key,null)
   }finally{socket?.terminate();stop();router.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
   assert.equal(ctx.bus.listenerCount(),0)
  })
  assert.equal(sqliteAccess,0)
 }finally{identity.mock.restore();await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)} WITH (FORCE)`;await admin.close()}
})
