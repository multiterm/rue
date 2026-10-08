import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {expect,test,vi} from 'vitest'
import {createAgentSession,ModelRuntime,SettingsManager,DefaultResourceLoader} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore} from '@earendil-works/pi-ai'
import {persistentSession,flushSession} from '../src/session.js'
import {ManagedCompactor} from '../src/compaction.js'
test('real Pi compaction persists in its session without generating mirrorable assistant messages or replaying a prompt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rue-compact-sdk-')),id=randomUUID(),network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('No live model call allowed'))
 let dispose=()=>{}
 try{
  const manager=persistentSession(dir,join(dir,'sessions'),id)
  const models=await ModelRuntime.create({modelsPath:null,credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),allowModelNetwork:false})
  await models.setRuntimeApiKey('openai','synthetic-test-key')
  const model=models.getModel('openai','gpt-4.1-mini')!;expect(model).toBeTruthy()
  for(let n=0;n<4;n++){
   manager.appendMessage({role:'user',content:`Turn ${n}: `+'Old context. '.repeat(100),timestamp:n*2})
   manager.appendMessage({role:'assistant',content:[{type:'text',text:'Assistant history. '.repeat(100)}],api:model.api,provider:model.provider,model:model.id,stopReason:'stop',timestamp:n*2+1,usage:{input:100,output:100,cacheRead:0,cacheWrite:0,totalTokens:200,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
  }
  const original=manager.getEntries().length,settings=SettingsManager.inMemory({compaction:{enabled:false,keepRecentTokens:64,reserveTokens:64},retry:{enabled:false}})
  const loader=new DefaultResourceLoader({cwd:dir,agentDir:dir,settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,extensionFactories:[pi=>{pi.on('session_before_compact',event=>({compaction:{summary:'Deterministic private test summary',firstKeptEntryId:event.preparation.firstKeptEntryId,tokensBefore:event.preparation.tokensBefore}}))}]})
  await loader.reload()
  const {session}=await createAgentSession({cwd:dir,agentDir:dir,model,modelRuntime:models,sessionManager:manager,settingsManager:settings,resourceLoader:loader,tools:[]});dispose=()=>session.dispose()
  const beforeCompact=manager.getEntries().length
  const messages:string[]=[];session.subscribe(event=>{if(['message_start','message_update','message_end'].includes(event.type))messages.push(event.type)})
  let acknowledged=false
  const compact=new ManagedCompactor({idle:()=>session.isIdle,claim:async()=>({execute:true,nonce:'n'.repeat(43),serverNow:1000,deadline:121000}),compact:async signal=>{const abort=()=>session.abortCompaction();signal.addEventListener('abort',abort,{once:true});try{return await session.compact()}finally{signal.removeEventListener('abort',abort)}},persist:async()=>flushSession(manager.getSessionFile()!),acknowledge:async(_id,_nonce,outcome)=>{expect(outcome).toBe('succeeded');expect(readFileSync(manager.getSessionFile()!,'utf8')).toContain('Deterministic private test summary');acknowledged=true},uncertain:()=>{}})
  expect(await compact.execute(randomUUID())).toBe('succeeded');expect(acknowledged).toBe(true);expect(messages).toEqual([])
  const reopened=persistentSession(dir,join(dir,'sessions'),id);expect(reopened.getEntries()).toHaveLength(beforeCompact+1);expect(reopened.getEntries().filter(entry=>entry.type==='message')).toHaveLength(original);expect(reopened.getEntries().at(-1)?.type).toBe('compaction');expect(network).not.toHaveBeenCalled()
 }finally{dispose();network.mockRestore();rmSync(dir,{recursive:true,force:true})}
})
