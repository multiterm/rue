import {expect,test,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {createAgentSession,ModelRuntime,SettingsManager,DefaultResourceLoader,SessionManager} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore} from '@earendil-works/pi-ai'
import {connectMcp} from '../src/mcp.js'
import {BoundedStdioTransport} from '../src/mcp-transport.js'
const server=`const r=require('node:readline').createInterface({input:process.stdin});r.on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;let result;if(q.method==='initialize')result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};else if(q.method==='tools/list')result={tools:[{name:'echo',description:'Fixture',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};else if(q.method==='tools/call')result={content:[{type:'text',text:process.env.EXAMPLE_SECRET==='synthetic'&&!process.env.RUE_TEST_INHERITED?'guarded '+q.params.arguments.text:'unsafe'}],structuredContent:{ordered:true},isError:q.params.arguments.text==='error'};if(result)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n')})`
test('actual MCP SDK negotiates stdio, executes ordered content, isolates env and registers stable owned tools',async()=>{
 vi.stubEnv('RUE_TEST_INHERITED','must-not-reach-child')
 const mcp=await connectMcp([{id:randomUUID(),name:'Fixture',command:process.execPath,args:['-e',server],environment:{EXAMPLE_SECRET:'synthetic'}}],process.cwd())
 try{
  const tool=mcp.tools[0]
  expect(tool.name).toMatch(/^mcp_[a-f0-9]{24}$/)
  const result=await tool.execute('call',{text:'hello'},undefined,undefined,{} as never)
  expect(result.content).toEqual([{type:'text',text:'guarded hello'},{type:'text',text:'{"ordered":true}'}])
  const failed=await tool.execute('call',{text:'error'},undefined,undefined,{} as never)
  expect(failed.details).toMatchObject({mcpError:true})
  const registrations:unknown[]=[],hooks=new Map<string,Function>()
  await mcp.factory({registerTool:(tool:unknown)=>registrations.push(tool),on:(name:string,hook:Function)=>hooks.set(name,hook)} as never)
  expect(registrations).toEqual(mcp.tools)
  expect(hooks.get('tool_result')!({toolName:tool.name,details:failed.details})).toEqual({isError:true})
  expect(hooks.get('tool_result')!({toolName:'unrelated',details:failed.details})).toBeUndefined()
  const directory=mkdtempSync(tmpdir()+'/rue-mcp-sdk-')
  try{
   const models=await ModelRuntime.create({modelsPath:null,credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),allowModelNetwork:false})
   const settings=SettingsManager.inMemory(),resources=new DefaultResourceLoader({cwd:directory,agentDir:directory,settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,noContextFiles:true,extensionFactories:[mcp.factory]})
   await resources.reload()
   const {session}=await createAgentSession({cwd:directory,agentDir:directory,model:models.getModel('openai','gpt-4.1-mini'),modelRuntime:models,settingsManager:settings,sessionManager:SessionManager.inMemory(directory),resourceLoader:resources,tools:['read',...mcp.toolNames]})
   expect(session.getActiveToolNames()).toEqual(['read',...mcp.toolNames]);session.dispose()
  }finally{rmSync(directory,{recursive:true,force:true})}
 }finally{await mcp.close();vi.unstubAllEnvs()}
})
test('oversized stdout fails closed without exposing diagnostics',async()=>{
 const transport=new BoundedStdioTransport(process.execPath,['-e',"process.stdout.write('x'.repeat(1100000));setInterval(()=>{},1000)"],{},process.cwd())
 const failure=new Promise<string>(resolve=>{transport.onerror=e=>resolve(e.message)})
 await transport.start()
 expect(await failure).toBe('agent_mcp_protocol_failed')
 await transport.close()
})
