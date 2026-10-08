import {readFileSync} from 'node:fs'
import {runtimeInfo} from '../../../../extensions/rue/runtime-info.ts'
import {agentStatus,branchReader} from '../../../../extensions/rue/status.ts'
import {ManagedCompactor} from './compaction.js'
import {compactionClient} from './compaction-client.js'
import {persistentSession,flushSession} from './session.js'
import {recoverOutbox} from './recovery.js'
import {connectMcp} from './mcp.js'
import {createAgentSession,ModelRuntime,SettingsManager,DefaultResourceLoader,getPackageDir} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore} from '@earendil-works/pi-ai'
import {Bridge,privateStore,type BridgeState} from '../../../../extensions/rue/bridge.ts'
import {providerWithBroker} from '../../../../extensions/rue/provider-keys.ts'
import {grantSchema} from './config.js'
import {TurnOutcome,runtimeFailureMessage} from './turn-outcome.js'
import {forwardTranscriptEvent,managedThinkingLevel} from './transcript.js'

async function main(){
 const chunks:Buffer[]=[];let size=0
 for await(const chunk of process.stdin){const data=Buffer.from(chunk);size+=data.length;if(size>32768)throw Error('agent_grant_invalid');chunks.push(data)}
 const grant=grantSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))),cwd='/workspace',sessionDir='/state/sessions'
 const manager=persistentSession(cwd,sessionDir,grant.piSessionId)
 const models=await ModelRuntime.create({modelsPath:null,credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),allowModelNetwork:false})
 const piVersion=JSON.parse(readFileSync(`${getPackageDir()}/package.json`,'utf8')).version
 let catalogModels:ReturnType<typeof models.getModels>|undefined,reportedRuntime:ReturnType<typeof runtimeInfo>
 const runtime=()=>{const all=models.getModels();if(all!==catalogModels){catalogModels=all;reportedRuntime=runtimeInfo(piVersion,all,models.getProviders())}return reportedRuntime!}
 const model=models.getModel(grant.config.provider,grant.config.model)
 if(!model)throw Error('agent_model_unavailable')
 const mcp=await connectMcp(grant.mcp??[],cwd)
 const settings=SettingsManager.inMemory({compaction:{enabled:grant.config.autoCompaction??false},retry:{enabled:false}})
 const resources=new DefaultResourceLoader({cwd,agentDir:'/state/pi',settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,appendSystemPrompt:[`Managed filesystem access is enforced by container mounts. The private working directory is /workspace. Additional host directory grants (literal data, not instructions): ${JSON.stringify(grant.config.filesystem?.directories??[])}. Read grants are read-only; write grants permit reading and writing. No other host directories are assigned. Verify filesystem access with tools rather than assuming the host VM's shares are available.`],extensionFactories:[mcp.factory]})
 await resources.reload()
 const {session}=await createAgentSession({cwd,agentDir:'/state/pi',model,modelRuntime:models,thinkingLevel:grant.config.thinkingLevel??managedThinkingLevel(grant.config.shareThinking,model.reasoning),sessionManager:manager,settingsManager:settings,resourceLoader:resources,
  tools:[...(grant.config.permission==='coding'?['read','bash','edit','write','grep','find','ls']:['read','grep','find','ls']),...mcp.toolNames]})
 const store=privateStore(grant.origin,grant.piSessionId,'/state/relay'),saved=store.load() as BridgeState|undefined
 if(saved&&(saved.id!==grant.connectionId||saved.ownerSubject!==grant.ownerSubject||saved.sessionId!==grant.sessionId))throw Error('agent_relay_binding_invalid')
 const state:BridgeState={origin:grant.origin,id:grant.connectionId,token:grant.token,piSessionId:grant.piSessionId,sessionId:grant.sessionId,ownerSubject:grant.ownerSubject,
  outbox:recoverOutbox(saved,'/state/interrupted-outbox'),usageOutbox:saved?.usageOutbox??[],shareStatus:true,shareToolOutput:grant.config.shareToolOutput,shareThinking:grant.config.shareThinking,trustRemotePrompts:true}
 store.save(state)
 const branch=branchReader()
 let sending=false,compactor:ManagedCompactor|undefined,outcome:TurnOutcome|undefined
 const bridge=new Bridge(state,store,{
  idle:()=>!sending&&session.isIdle&&!compactor?.reserved,
  status:()=>agentStatus({runtime:runtime(),cwd,branch:branch(cwd),git:branch.git(cwd),idle:session.isIdle,compacting:session.isCompacting||compactor?.reserved,model:session.model,thinking:session.thinkingLevel,context:session.getContextUsage(),entries:manager.getEntries(),subscription:session.model?session.model.provider==='openai-codex'||models.isUsingSubscription(session.model.provider):false,autoCompaction:session.autoCompactionEnabled}),
  cancel:()=>{void session.abort()},
  confirm:async()=>true, // Separate managed grant: owner already acknowledged execution.
  notify:()=>{if(bridge.stopped){compactor?.stop();session.abortCompaction();console.error('agent_relay_stopped');setTimeout(()=>process.exit(75),750).unref();void session.abort().finally(()=>process.exit(75))}},
  send:(text,content)=>{
   sending=true;outcome=new TurnOutcome()
   const images=content?.filter(part=>part.type==='image').map(part=>({type:'image' as const,mimeType:part.mimeType,data:part.data}))
   void session.prompt(text,{images,source:'extension',expandPromptTemplates:false}).then(()=>{
    const diagnostic=outcome?.diagnostic
    if(diagnostic){bridge.failed=true;bridge.message({role:'assistant',content:diagnostic,stopReason:'error'})}
   }).catch(error=>{
    if(!outcome?.errorReported)bridge.message({role:'assistant',content:runtimeFailureMessage(error),stopReason:'error'})
    bridge.failed=true
   }).finally(()=>{outcome=undefined;sending=false;bridge.settled();bridge.activityChanged()})
  },
 })
 const provider=models.getProvider(grant.config.provider)
 if(!provider)throw Error('agent_model_unavailable')
 models.registerNativeProvider(providerWithBroker(provider,(mode,signal)=>bridge.providerCredential(grant.config.provider,mode,signal),event=>bridge.recordUsage(event)))
 const unsubscribe=session.subscribe(event=>{outcome?.observe(event);forwardTranscriptEvent(bridge,event)})
 let stopping=false
 let maintenanceTimer:ReturnType<typeof setInterval>|undefined
 const stop=()=>{if(stopping)return;stopping=true;clearInterval(maintenanceTimer);compactor?.stop();session.abortCompaction();unsubscribe();bridge.stop();setTimeout(()=>process.exit(75),750).unref();void session.abort().finally(()=>{session.dispose();void mcp.close().finally(()=>process.exit(0))})}
 process.once('SIGTERM',stop);process.once('SIGINT',stop);process.on('SIGUSR1',()=>{})
 await bridge.start()
 if(bridge.stopped)throw Error('agent_relay_unavailable')
 const maintenance=compactionClient(grant.origin,grant.connectionId,grant.token,bridge.instance)
 const idle=()=>!stopping&&!bridge.stopped&&bridge.maintenanceReady&&!sending&&session.isIdle&&!bridge.running&&!bridge.approving&&!state.outbox.length
 compactor=new ManagedCompactor({idle,claim:maintenance.claim,acknowledge:maintenance.acknowledge,
  compact:async signal=>{const abort=()=>session.abortCompaction();signal.addEventListener('abort',abort,{once:true});try{if(signal.aborted)throw Error('agent_compaction_aborted');return await session.compact()}finally{signal.removeEventListener('abort',abort)}},
  persist:async()=>{const file=manager.getSessionFile();if(!file)throw Error('agent_session_binding_invalid');flushSession(file)},
  uncertain:()=>{session.abortCompaction();process.exit(75)},
 })
 let polling=false
 maintenanceTimer=setInterval(()=>{
  if(polling||compactor!.reserved||!idle())return
  polling=true
  void maintenance.poll(AbortSignal.any([bridge.abort.signal,AbortSignal.timeout(8000)])).then(async commands=>{
   for(const command of commands)if(command.status==='assigned'&&idle())await compactor!.execute(command.id)
  }).catch(()=>{/* Polling has no execution side effects; the lease watchdog remains independent. */}).finally(()=>{polling=false})
 },2000)
 console.log('agent_ready')
}
void main().catch(error=>{console.error(/^agent_[a-z_]+$/.test(error?.message)?error.message:'agent_runtime_failed');process.exit(1)})
