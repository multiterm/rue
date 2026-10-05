import {randomUUID} from 'node:crypto'
import {afterEach,expect,test,vi} from 'vitest'
import {openDatabase} from '../../src/storage/db.js'
import {createMcpProfile,listMcpProfiles,removeMcpProfile,resolveMcpProfiles} from '../../src/storage/mcp.js'
import {createWorker,connectWorker,heartbeatWorker} from '../../src/storage/workers.js'
import {createManagedAgent,changeManagedAgent,managedGrant,listManagedAgents} from '../../src/storage/managed-agents.js'
import {authenticateTerminalConnection} from '../../src/storage/terminal-pairing.js'
const dbs:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for(const db of dbs.splice(0))db.close();vi.unstubAllEnvs()})
const input={name:'Owned tools',command:'node',args:['server.mjs'],environment:{EXAMPLE_SECRET:'synthetic-mcp-secret'},acknowledgeTools:true as const}
function setup(){vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,1).toString('base64'));const db=openDatabase(':memory:');dbs.push(db);return db}
test('MCP credentials are encrypted, metadata never decrypts, ownership and retries are enforced',()=>{
 const db=setup(),id=randomUUID(),profile=createMcpProfile(db,'owner',id,input,1000)
 expect(profile.environmentNames).toEqual(['EXAMPLE_SECRET'])
 expect(createMcpProfile(db,'owner',id,input,1001)).toEqual(profile)
 expect(()=>createMcpProfile(db,'owner',id,{...input,name:'different'})).toThrow('mcp_request_conflict')
 expect(()=>resolveMcpProfiles(db,'other',[id])).toThrow('mcp_profile_unavailable')
 expect(listMcpProfiles(db,'other')).toEqual([])
 expect(()=>removeMcpProfile(db,'other',id,1)).toThrow('mcp_profile_not_found')
 expect(JSON.stringify(db.prepare('SELECT * FROM mcp_profiles').all())).not.toContain(input.environment.EXAMPLE_SECRET)
 expect(resolveMcpProfiles(db,'owner',[id])[0].environment).toEqual(input.environment)
 vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',Buffer.alloc(32,2).toString('base64'))
 expect(listMcpProfiles(db,'owner')).toEqual([profile])
 expect(()=>resolveMcpProfiles(db,'owner',[id])).toThrow()
})
test('MCP selection requires coding consent and a capable host; removal fences grants and strips only that selection',()=>{
 const db=setup(),id=randomUUID();createMcpProfile(db,'owner',id,input,1000)
 const w=createWorker(db,'owner','MCP host',randomUUID(),1000),instance=randomUUID(),lease=connectWorker(db,w.worker.id,w.secret!,instance,1000)
 const auth={id:w.worker.id,secret:w.secret!,instance,generation:lease.generation}
 const request={workerId:w.worker.id,requestId:randomUUID(),name:'MCP agent',acknowledgeExecution:true,config:{provider:'openai',model:'gpt-4.1-mini',permission:'coding',mounts:[],shareToolOutput:false,shareThinking:false,mcp:[id]}}
 expect(()=>createManagedAgent(db,'owner',request,1001)).toThrow('managed_mcp_not_supported')
 heartbeatWorker(db,w.worker.id,w.secret!,instance,lease.generation,{version:'0.2.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:true,cpus:2,freeMemoryBytes:1e9,capabilities:['host-health-v1','managed-agents-v1','managed-mcp-v1']},1001)
 expect(()=>createManagedAgent(db,'owner',{...request,config:{...request.config,permission:'read-only'}},1002)).toThrow()
 const a=createManagedAgent(db,'owner',request,1002).agent,g=managedGrant(db,auth,a.id,1,1003)
 expect(g.mcp?.[0].environment).toEqual(input.environment)
 expect(()=>removeMcpProfile(db,'owner',id,9,1004)).toThrow('mcp_revision_conflict')
 const removed=removeMcpProfile(db,'owner',id,1,1004)
 expect(removed.agents.map(a=>a.id)).toEqual([a.id])
 expect(()=>authenticateTerminalConnection(db,g.token,g.id,1005)).toThrow()
 expect(listManagedAgents(db,'owner')[0]).toMatchObject({desired:'stopped',revision:2})
 expect(listManagedAgents(db,'owner')[0].config.mcp).toBeUndefined()
 expect(db.prepare('SELECT encrypted_env FROM mcp_profiles WHERE id=?').get(id)).toEqual({encrypted_env:null})
 expect(()=>resolveMcpProfiles(db,'owner',[id])).toThrow('mcp_profile_unavailable')
 expect(removeMcpProfile(db,'owner',id,1,1006).agents).toEqual([])
 const replacement=randomUUID();createMcpProfile(db,'owner',replacement,input,1007)
 const config={...request.config,mcp:[replacement]},change={requestId:randomUUID(),expectedRevision:2,action:'configure',config,acknowledgeExecution:true}
 expect(()=>changeManagedAgent(db,'owner',a.id,{...change,acknowledgeExecution:undefined},1008)).toThrow()
 const configured=changeManagedAgent(db,'owner',a.id,change,1008)
 expect(configured.agent).toMatchObject({desired:'stopped',revision:3,sessionId:a.sessionId,config:{mcp:[replacement]}})
 expect(changeManagedAgent(db,'owner',a.id,change,1009)).toEqual(configured)
 changeManagedAgent(db,'owner',a.id,{requestId:randomUUID(),expectedRevision:3,action:'resume'},1010)
 expect(managedGrant(db,auth,a.id,4,1011).mcp?.[0].id).toBe(replacement)
})
