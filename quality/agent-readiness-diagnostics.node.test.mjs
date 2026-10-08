import {test} from 'node:test'
import assert from 'node:assert/strict'
import {agentDiagnostics} from '../packages/apps/webapp/src/agent-diagnostics.ts'
import {botCreationReadiness} from '../packages/apps/webapp/src/bot-creation-readiness.ts'
const host={ownerSubject:'owner',status:'online',desired:'active',health:{dockerAvailable:true,acceptingWork:true,capabilities:['managed-agents-v1']}}
const keys={ownerSubject:'owner',keyStorageAvailable:true,keys:[{provider:'openai',configured:true}]}
test('creation requires matching owner, host, model and a saved credential',()=>{
 const check=(h=host,k=keys,model=true)=>botCreationReadiness('owner',{provider:'openai'},h,k,model)
 assert.equal(check().canCreate,true)
 for(const h of [undefined,{...host,ownerSubject:'other'},{...host,status:'offline'},{...host,health:{...host.health,dockerAvailable:false}}])assert.equal(botCreationReadiness('owner',{provider:'openai'},h,keys,true).canCreate,false)
 assert.equal(check(host,{...keys,ownerSubject:'other'}).canCreate,false);assert.equal(check(host,{...keys,keyStorageAvailable:false}).canCreate,false);assert.equal(check(host,{...keys,keys:[]}).canCreate,false);assert.equal(check(host,keys,false).canCreate,false)
})
test('capacity waits do not remove shared slots; per-bot grants are still explicit after creation',()=>{
 const result=botCreationReadiness('owner',{provider:'openai'},{...host,health:{...host.health,acceptingWork:false}},keys,true)
 assert.equal(result.canCreate,true);assert.match(JSON.stringify(result.rows),/wait for capacity/);assert.match(JSON.stringify(result.rows),/Required after creation/)
})
test('Codex needs both host support and its own ready OAuth credential',()=>{
 const config={provider:'openai-codex'},k={...keys,oauth:{ownerSubject:'owner',configured:true,keyStorageAvailable:true,runtimeSupported:true,state:'ready'}}
 assert.equal(botCreationReadiness('owner',config,host,k,true).canCreate,false)
 const h={...host,health:{...host.health,capabilities:['managed-agents-v1','managed-codex-v1']}}
 assert.equal(botCreationReadiness('owner',config,h,k,true).canCreate,true)
 k.oauth.state='reauthorize';assert.equal(botCreationReadiness('owner',config,h,k,true).canCreate,false)
})
test('diagnostics exclude private data and raw errors and bind to the selected owner/session',()=>{
 const session={id:'session',ownerSubject:'owner',terminalConnectionId:'connection',meta:{managedAgentId:'agent'},title:'private-name'}
 const computer={id:'connection',sessionId:'session',ownerSubject:'owner',status:'online',name:'private-host',lastSeenAt:1000,leaseExpiresAt:61000,health:{transport:'https',uploadFailures:0,status:{piVersion:'0.87.1',state:'idle',provider:'openai',model:'model-id',cwd:'/private/repo',git:{branch:'private-branch'},context:{percent:20,tokens:20,window:100},token:'private-token'}}}
 const agent={id:'agent',sessionId:'session',connectionId:'connection',desired:'running',observed:'running',revision:2,observedRevision:1,error:'Authorization: Bearer private-error',config:{apiKey:'private-key'}}
 const text=agentDiagnostics(session,computer,agent,true,false,2000),report=JSON.parse(text)
 assert.doesNotMatch(text,/private-|\/private|Authorization|Bearer/);assert.equal(report.runtime.model,'model-id');assert.equal(report.managed.errorDetected,true);assert.equal(report.check,'fresh')
 const wrong=JSON.parse(agentDiagnostics(session,{...computer,ownerSubject:'other'},agent,true,false,2000));assert.equal(wrong.runtime.model,null);assert.equal(wrong.managed,null)
 computer.health.status.model='sk-secret';assert.equal(JSON.parse(agentDiagnostics(session,computer,agent,false,true,2000)).runtime.model,null)
})
