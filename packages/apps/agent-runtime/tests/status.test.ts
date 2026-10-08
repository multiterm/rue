import {Bridge} from '../../../../extensions/rue/bridge.js'
import {expect,test,vi} from 'vitest'
import {agentStatus} from '../../../../extensions/rue/status.js'
import {agentStatusSchema} from '../../core/src/storage/agent-status.js'
const usage=(input:number,cacheRead:number,cost:number)=>({input,output:20,cacheRead,cacheWrite:10,cost:{total:cost}})
test('status matches Pi footer accounting including tool and summary entries without copying private content',()=>{
 const result=agentStatus({cwd:'/workspace',branch:'develop',idle:true,model:{provider:'openai-codex',id:'test-model',contextWindow:272000},thinking:'medium',context:{tokens:161568,contextWindow:272000,percent:59.4},subscription:true,autoCompaction:false,entries:[
  {type:'message',message:{role:'user',content:'private user text'}},
  {type:'message',message:{role:'assistant',content:'private reasoning',usage:usage(100,890,1)}},
  {type:'message',message:{role:'toolResult',content:'private file',usage:usage(2,3,.1)}},
  {type:'compaction',summary:'private summary',usage:usage(4,5,.2)},
  {type:'branch_summary',summary:'private branch',usage:usage(6,7,.3)},
 ]})
 expect(result.usage).toEqual({input:112,output:80,cacheRead:905,cacheWrite:40,costUsd:1.6})
 expect(result.cacheHitPercent).toBe(89);expect(result.context.percent).toBe(59.4);expect(JSON.stringify(result)).not.toContain('private')
 expect(agentStatusSchema.parse(result)).toEqual(result)
})
test('manual links report status only with its independent sharing preference',()=>{
 const status=vi.fn(()=>agentStatus({cwd:'/private/project',branch:null,idle:true,thinking:'off',entries:[]}))
 const bridge=new Bridge({origin:'https://rue.test',id:'fixture',token:'fixture',piSessionId:'fixture',outbox:[],shareToolOutput:true,shareThinking:true},{save:()=>{}},{idle:()=>true,status,send:()=>{},cancel:()=>{},notify:()=>{},confirm:async()=>false})
 expect(bridge.diagnostics()).not.toHaveProperty('status');expect(status).not.toHaveBeenCalled()
 bridge.state.shareStatus=true;expect(bridge.diagnostics()).toHaveProperty('status.cwd','/private/project')
 bridge.state.shareStatus=false;expect(bridge.diagnostics()).not.toHaveProperty('status')
 bridge.stop()
})
test('unknown post-compaction context remains unknown, malformed counters and control text are bounded',()=>{
 const result=agentStatus({cwd:'/work\nspace',branch:'\u202eevil',idle:false,compacting:true,thinking:'off',model:{provider:'openai',id:'test',contextWindow:1000},entries:[{type:'message',message:{role:'assistant',usage:{input:Infinity,output:-3,cacheRead:NaN,cacheWrite:0,cost:{total:Infinity}}}}]})
 expect(result.context).toEqual({tokens:null,percent:null,window:1000});expect(result.state).toBe('compacting');expect(result.cwd).toBe('/workspace');expect(result.branch).toBe('evil')
 expect(result.subscription).toBeNull();expect(result.autoCompaction).toBeNull();expect(result.usage.input).toBe(0)
 expect(agentStatusSchema.safeParse({...result,apiKey:'never accepted'}).success).toBe(false)
})
