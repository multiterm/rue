import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,chmodSync,utimesSync,unlinkSync,symlinkSync} from 'node:fs'
import {createReadTool,createWriteTool,createEditTool,createBashTool,createAgentSession,ModelRuntime,SettingsManager,DefaultResourceLoader,SessionManager} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore} from '@earendil-works/pi-ai'
const cwd='/workspace'
if(process.env.RUE_TEST_MOUNT_POLICY==='1'){
 const file='/Volumes/MOTHERSHIP/read-only/file'
 assert.equal(readFileSync(file,'utf8'),'synthetic-read-only')
 for(const mutate of [()=>writeFileSync(file,'bad'),()=>chmodSync(file,0o777),()=>utimesSync(file,new Date(),new Date()),()=>unlinkSync(file)]){
  assert.throws(mutate,error=>error.code==='EROFS')
 }
 writeFileSync('/Volumes/MOTHERSHIP/read-write/file','synthetic-writable')
 symlinkSync('/var/lib/docker/volumes','/Volumes/MOTHERSHIP/read-write/escape')
 assert.throws(()=>readFileSync('/Volumes/MOTHERSHIP/read-write/escape/secret'),error=>error.code==='ENOENT')
 assert.equal(readFileSync(file,'utf8'),'synthetic-read-only')
 console.log('PASS read-only mount content and metadata; writable grant; absent host-storage escape')
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js')
 const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js')
 const program=`import {Server} from '@modelcontextprotocol/sdk/server/index.js';import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';import fs from 'node:fs';const server=new Server({name:'filesystem-probe',version:'1'},{capabilities:{tools:{}}});server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'check',inputSchema:{type:'object',properties:{}}}]}));server.setRequestHandler(CallToolRequestSchema,async()=>{let deniedWrite=false,deniedMetadata=false;try{fs.writeFileSync('/Volumes/MOTHERSHIP/read-only/file','bad')}catch(e){deniedWrite=e.code==='EROFS'}try{fs.chmodSync('/Volumes/MOTHERSHIP/read-only/file',511)}catch(e){deniedMetadata=e.code==='EROFS'}fs.writeFileSync('/Volumes/MOTHERSHIP/read-write/mcp','synthetic-mcp');const writable=fs.readFileSync('/Volumes/MOTHERSHIP/read-write/mcp','utf8')==='synthetic-mcp';fs.unlinkSync('/Volumes/MOTHERSHIP/read-write/mcp');return{content:[{type:'text',text:JSON.stringify({deniedWrite,deniedMetadata,writable})}]}});await server.connect(new StdioServerTransport());`
 const client=new Client({name:'filesystem-test',version:'1'})
 const transport=new StdioClientTransport({command:'/usr/local/bin/node',args:['--input-type=module','-e',program],cwd:'/app',stderr:'pipe'})
 try{await client.connect(transport);const result=await client.callTool({name:'check',arguments:{}});assert.deepEqual(JSON.parse(result.content[0].text),{deniedWrite:true,deniedMetadata:true,writable:true});console.log('PASS real stdio MCP inherits read/write filesystem restrictions')}finally{await client.close();await transport.close()}
}
await createWriteTool(cwd).execute('write-test',{path:'test.txt',content:'before\n'})
await createEditTool(cwd).execute('edit-test',{path:'test.txt',edits:[{oldText:'before',newText:'after'}]})
const read=await createReadTool(cwd).execute('read-test',{path:'test.txt'})
assert(read.content.some(c=>c.type==='text'&&c.text.includes('after')))
console.log('PASS native Pi read/write/edit tools')
await createBashTool(cwd).execute('bash-test',{command:'test "$(cat /workspace/test.txt)" = after',timeout:5})
console.log('PASS native Pi bash tool')
const models=await ModelRuntime.create({modelsPath:null,credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),allowModelNetwork:false})
const model=models.getModel('openai','gpt-6-astra');assert(model)
const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}})
const resources=new DefaultResourceLoader({cwd,agentDir:'/state/pi',settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true})
await resources.reload()
const {session}=await createAgentSession({cwd,agentDir:'/state/pi',model,modelRuntime:models,settingsManager:settings,resourceLoader:resources,sessionManager:SessionManager.create(cwd,'/state/sessions')})
session.dispose()
console.log('PASS native Pi session initialization; no inference')
try{
 await createBashTool(cwd).execute('git-test',{command:'git init -q /workspace/test-repo',timeout:5})
 console.log('PASS git init')
}catch{
 console.log('INCOMPATIBLE git init (must resolve before production integration)')
 process.exitCode=2
}
