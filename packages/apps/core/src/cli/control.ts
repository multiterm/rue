import type {CommandModule} from 'yargs'
import {createRueClient,RueApiError,type RueRuntimeRollout} from '@multiterm/rue-sdk'
import {managedConfigSchema,managedCreateSchema} from '../storage/managed-agents.js'
import {constants,openSync,fstatSync,readSync,readFileSync,closeSync} from 'node:fs'
import {isAbsolute} from 'node:path'
import {createControlCredentialStore} from '../auth/control-credentials.js'
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,digest=/^sha256:[a-f0-9]{64}$/
export function readControlToken(path:string){
 if(!isAbsolute(path))throw Error('rue_control_token_file_invalid')
 let fd:number|undefined
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)||stat.uid!==process.getuid?.()||stat.size>16384)throw Error('invalid');const token=readFileSync(fd,'utf8').trim();if(!/^tnk_[A-Za-z0-9_-]+$/.test(token))throw Error('invalid');return token}catch{throw Error('rue_control_token_file_invalid')}finally{if(fd!==undefined)closeSync(fd)}
}
export function readControlConfig(path:string){
 if(!isAbsolute(path))throw Error('rue_control_config_file_invalid')
 let fd:number|undefined
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd),limit=65536
  if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)||stat.uid!==process.getuid?.()||stat.size>limit)throw Error('invalid')
  const buffer=Buffer.alloc(limit+1);let size=0
  while(size<buffer.length){const count=readSync(fd,buffer,size,buffer.length-size,null);if(!count)break;size+=count}
  if(size>limit)throw Error('invalid')
  return managedConfigSchema.parse(JSON.parse(buffer.subarray(0,size).toString('utf8')))
 }catch{throw Error('rue_control_config_file_invalid')}finally{if(fd!==undefined)closeSync(fd)}
}
function acknowledgedConfig(argv:any){
 if(!argv.acknowledgeExecution)throw Error('rue_control_execution_acknowledgement_required')
 const config=readControlConfig(String(argv.configFile??''))
 if(config.filesystem!==undefined&&!argv.acknowledgeFilesystem)throw Error('rue_control_filesystem_acknowledgement_required')
 return config
}
export function readRelayControlSource(path:string,expectedOrigin:string){
 if(!isAbsolute(path))throw Error('rue_control_relay_file_invalid')
 let fd:number|undefined
 try{
  const origin=new URL(expectedOrigin);if(origin.protocol!=='https:'||origin.origin!==expectedOrigin.replace(/\/$/,'')||origin.username||origin.password)throw Error('invalid')
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd)
  if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)||stat.uid!==process.getuid?.()||stat.size>1000000)throw Error('invalid')
  const value=JSON.parse(readFileSync(fd,'utf8'))
  if(value.origin!==origin.origin||!/^term_[A-Za-z0-9_-]{32}$/.test(value.id)||!/^rue_terminal_[A-Za-z0-9_-]{43}$/.test(value.token))throw Error('invalid')
  return {origin:origin.origin,id:String(value.id),token:String(value.token)}
 }catch{throw Error('rue_control_relay_file_invalid')}finally{if(fd!==undefined)closeSync(fd)}
}
async function client(argv:Record<string,unknown>){
 const raw=String(argv.apiUrl??process.env.RUE_CONTROL_API_URL??''),path=String(argv.tokenFile??process.env.RUE_CONTROL_TOKEN_FILE??'')
 let url:URL;try{url=new URL(raw)}catch{throw Error('rue_control_https_origin_required')}
 if(url.protocol!=='https:'||url.origin!==raw.replace(/\/$/,'')||url.username||url.password)throw Error('rue_control_https_origin_required')
 const token=path?readControlToken(path):await createControlCredentialStore().get(url.origin)
 if(!token)throw Error('rue_control_login_required')
 return createRueClient({baseUrl:url.origin,token,fetch:(input,init)=>fetch(input,{...init,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(15000),...(init?.signal?[init.signal]:[])])})})
}
function relayClient(argv:Record<string,unknown>){const source=readRelayControlSource(String(argv.relayStateFile??''),String(argv.apiUrl??process.env.RUE_CONTROL_API_URL??''));return {source,api:createRueClient({baseUrl:source.origin,token:source.token,fetch:(url,init)=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)})})}}
const output=(value:unknown)=>process.stdout.write(JSON.stringify(value,null,2)+'\n')
export function controlError(error:unknown){
 if(error instanceof RueApiError){let code='rue_control_request_failed';try{const supplied=JSON.parse(error.body)?.error;if(['runtime_rollout_manager_upgrade_required','worker_revision_conflict','runtime_image_conflict','runtime_rollout_active','api_key_permission_denied','api_key_invalid','tenancy_verification_unavailable','runtime_rollout_unavailable','worker_not_found','invalid_runtime_rollout','rollout_request_conflict','runtime_rollout_rate_limited','runtime_rollout_revision_conflict','runtime_rollout_host_not_stopped','runtime_rollout_already_started','runtime_rollout_inventory_too_large','runtime_control_not_approved','runtime_control_revision_conflict','runtime_control_agent_changed','runtime_control_request_conflict','managed_filesystem_not_supported','managed_filesystem_consent_required','managed_revision_conflict','managed_agent_not_found','managed_upgrade_not_supported','managed_upgrade_candidate_changed','managed_host_rollout_active','invalid_managed_agent_update'].includes(supplied))code=supplied}catch{}return {error:code,status:error.status}}
 return {error:error instanceof Error&&/^rue_control_[a-z_]+$/.test(error.message)?error.message:'rue_control_request_failed'}
}
const submissions=new WeakSet<object>()
export const controlSubmissionUnconfirmed=(attempted:boolean,error:unknown)=>attempted&&(!(error instanceof RueApiError)||error.status>=500||error.status===408)
const handle=(run:(argv:any)=>Promise<unknown>)=>async(argv:any)=>{try{output(await run(argv))}catch(error){output({...controlError(error),...(argv.requestId||submissions.has(argv)?{...(argv.requestId?{requestId:argv.requestId}:{}),resultUnconfirmed:controlSubmissionUnconfirmed(submissions.has(argv),error)}:{})});process.exitCode=1}}
export async function waitForRuntimeRollout(read:()=>Promise<RueRuntimeRollout>,timeoutMs:number,signal?:AbortSignal){
 const deadline=Date.now()+timeoutMs
 while(true){if(signal?.aborted)throw Error('rue_control_wait_cancelled');const job=await read();if(['succeeded','failed','uncertain'].includes(job.phase))return job;if(Date.now()>=deadline)throw Error('rue_control_wait_timed_out');await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,2000);signal?.addEventListener('abort',done,{once:true})})}
}
export const controlCommand:CommandModule={
 command:'control <command>',describe:'Scoped remote Rue host/agent control. Uses OS-stored login or an explicit private token file; output is JSON.',
 builder:y=>y.option('api-url',{type:'string',describe:'HTTPS Rue API origin; or RUE_CONTROL_API_URL'}).option('token-file',{type:'string',describe:'Private Tenancy machine-key file; or RUE_CONTROL_TOKEN_FILE'})
 .command({command:'self-status',describe:'Read only: inspect this agent’s manager readiness using its existing relay credential; grants no rollout authority',builder:z=>z.option('relay-state-file',{type:'string',demandOption:true}),handler:handle(async argv=>{const source=readRelayControlSource(argv.relayStateFile,String(argv.apiUrl??process.env.RUE_CONTROL_API_URL??''));return createRueClient({baseUrl:source.origin,token:source.token,fetch:(url,init)=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)})}).terminalRuntimeControl(source.id)})})
 .command({command:'self-rollout',describe:'Request a runtime update using this agent’s explicit owner approval; returns immediately so this task can drain',builder:z=>z.option('relay-state-file',{type:'string',demandOption:true}).option('image',{type:'string',demandOption:true}).option('expected-image',{type:'string',demandOption:true}).option('expected-revision',{type:'number',demandOption:true}).option('request-id',{type:'string',demandOption:true}).option('acknowledge-host-execution',{type:'boolean',default:false}),handler:handle(async argv=>{
  if(!uuid.test(argv.requestId)||!digest.test(argv.image)||!digest.test(argv.expectedImage)||!Number.isSafeInteger(argv.expectedRevision)||argv.expectedRevision<0||!argv.acknowledgeHostExecution)throw Error('rue_control_invalid_rollout_request')
  const {source,api}=relayClient(argv);submissions.add(argv)
  return api.rolloutOwnRuntime(source.id,{requestId:argv.requestId,image:argv.image,expectedImage:argv.expectedImage,expectedWorkerRevision:argv.expectedRevision,acknowledgeHostExecution:true})
 })})
 .command({command:'self-rollout-status <id>',describe:'Read a rollout submitted by this agent while its owner approval remains valid',builder:z=>z.positional('id',{type:'string',demandOption:true}).option('relay-state-file',{type:'string',demandOption:true}),handler:handle(async argv=>{if(!uuid.test(argv.id))throw Error('rue_control_invalid_id');const {source,api}=relayClient(argv);return api.ownRuntimeRollout(source.id,argv.id)})})
 .command({command:'access',describe:'Inspect this key’s owner-bound API authority and unsupported platform operations; does not grant access',handler:handle(async argv=>(await client(argv)).platformAccess())})
 .command({command:'agent-create <worker-id>',describe:'Create an owned agent using a private configuration and a stable request ID; may start execution',builder:z=>z.positional('worker-id',{type:'string',demandOption:true}).option('name',{type:'string',demandOption:true}).option('config-file',{type:'string',demandOption:true}).option('request-id',{type:'string',demandOption:true}).option('acknowledge-execution',{type:'boolean',default:false}).option('acknowledge-filesystem',{type:'boolean',default:false}),handler:handle(async argv=>{
  const config=acknowledgedConfig(argv),input=managedCreateSchema.safeParse({workerId:argv.workerId,name:argv.name,requestId:argv.requestId,config,acknowledgeExecution:true,...(argv.acknowledgeFilesystem?{acknowledgeFilesystem:true as const}:{})})
  if(!input.success)throw Error('rue_control_invalid_request')
  const api=await client(argv);submissions.add(argv);return api.createManagedAgent(input.data)
 })})
 .command({command:'agent-configure <id>',describe:'Apply a complete private JSON configuration and stop this agent; never resumes it',builder:z=>z.positional('id',{type:'string',demandOption:true}).option('config-file',{type:'string',demandOption:true}).option('expected-revision',{type:'number',demandOption:true}).option('request-id',{type:'string',demandOption:true}).option('acknowledge-execution',{type:'boolean',default:false}).option('acknowledge-filesystem',{type:'boolean',default:false}),handler:handle(async argv=>{
  if(!uuid.test(argv.id)||!uuid.test(argv.requestId)||!Number.isSafeInteger(argv.expectedRevision)||argv.expectedRevision<1)throw Error('rue_control_invalid_request')
  const config=acknowledgedConfig(argv),api=await client(argv);submissions.add(argv)
  return api.configureManagedAgent(argv.id,{requestId:argv.requestId,expectedRevision:argv.expectedRevision,config,acknowledgeExecution:true,...(argv.acknowledgeFilesystem?{acknowledgeFilesystem:true as const}:{})})
 })})
 .command({command:'agent-upgrade <id>',describe:'Update only this agent to an approved immutable local image; does not build or pull images',builder:z=>z.positional('id',{type:'string',demandOption:true}).option('image',{type:'string',demandOption:true}).option('expected-image',{type:'string',demandOption:true}).option('pi-version',{type:'string',demandOption:true}).option('expected-revision',{type:'number',demandOption:true}).option('request-id',{type:'string',demandOption:true}).option('acknowledge-execution',{type:'boolean',default:false}),handler:handle(async argv=>{
  if(!uuid.test(argv.id)||!uuid.test(argv.requestId)||!digest.test(argv.image)||argv.image.length!==71||!digest.test(argv.expectedImage)||argv.expectedImage.length!==71||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(argv.piVersion)||/[\r\n]/.test(argv.piVersion)||!Number.isSafeInteger(argv.expectedRevision)||argv.expectedRevision<1||!argv.acknowledgeExecution)throw Error('rue_control_invalid_request')
  const api=await client(argv);submissions.add(argv)
  return api.upgradeManagedAgent(argv.id,{requestId:argv.requestId,expectedRevision:argv.expectedRevision,image:argv.image,expectedImage:argv.expectedImage,piVersion:argv.piVersion,acknowledgeExecution:true})
 })})
 .command({command:'host-action <id>',describe:'Explicitly drain, activate or revoke an owned host; may affect all of its agents',builder:z=>z.positional('id',{type:'string',demandOption:true}).option('action',{choices:['drain','activate','revoke'] as const,demandOption:true}).option('expected-revision',{type:'number',demandOption:true}).option('acknowledge-host-control',{type:'boolean',default:false}),handler:handle(async argv=>{
  if(!uuid.test(argv.id)||!['drain','activate','revoke'].includes(argv.action)||!Number.isSafeInteger(argv.expectedRevision)||argv.expectedRevision<0||!argv.acknowledgeHostControl)throw Error('rue_control_invalid_request')
  const api=await client(argv);submissions.add(argv);const result=await api.changeWorker(argv.id,{action:argv.action,expectedRevision:argv.expectedRevision});return {worker:result.worker}
 })})
 .command({command:'hosts',describe:'List owned hosts and rollout capabilities',handler:handle(async argv=>(await client(argv)).workers())})
 .command({command:'agents',describe:'List owned managed agents',handler:handle(async argv=>(await client(argv)).managedAgents())})
 .command({command:'agent-operations <id>',describe:'Read this agent’s durable operation history before reconciling an unconfirmed request',builder:z=>z.positional('id',{type:'string',demandOption:true}),handler:handle(async argv=>{if(!uuid.test(argv.id))throw Error('rue_control_invalid_id');return (await client(argv)).managedOperations(argv.id)})})
 .command({command:'rollout-status <id>',describe:'Read a durable runtime rollout job',builder:z=>z.positional('id',{type:'string',demandOption:true}),handler:handle(async argv=>{if(!uuid.test(argv.id))throw Error('rue_control_invalid_id');return (await client(argv)).runtimeRollout(argv.id)})})
 .command({command:'agent-action <id>',describe:'Stop, resume or reload an agent with optimistic revision checking',builder:z=>z.positional('id',{type:'string',demandOption:true}).option('action',{choices:['stop','resume','reload'] as const,demandOption:true}).option('expected-revision',{type:'number',demandOption:true}).option('request-id',{type:'string',demandOption:true}),handler:handle(async argv=>{if(!uuid.test(argv.id)||!uuid.test(argv.requestId)||!Number.isSafeInteger(argv.expectedRevision)||argv.expectedRevision<1)throw Error('rue_control_invalid_request');const api=await client(argv);submissions.add(argv);return api.changeManagedAgent(argv.id,{action:argv.action,expectedRevision:argv.expectedRevision,requestId:argv.requestId})})})
 .command({command:'cancel-rollout <id>',describe:'Cancel a rollout before draining begins; never interrupts a running rollout',builder:z=>z.positional('id',{type:'string',demandOption:true}),handler:handle(async argv=>{if(!uuid.test(argv.id))throw Error('rue_control_invalid_id');return (await client(argv)).cancelRuntimeRollout(argv.id)})})
 .command({command:'resolve-rollout <id>',describe:'Resolve an uncertain rollout only after the host is drained and agents are confirmed stopped; does not resume anything',builder:z=>z.positional('id',{type:'string',demandOption:true}).option('expected-updated-at',{type:'number',demandOption:true}).option('acknowledge-stopped',{type:'boolean',default:false}),handler:handle(async argv=>{if(!uuid.test(argv.id)||!Number.isSafeInteger(argv.expectedUpdatedAt)||argv.expectedUpdatedAt<0||!argv.acknowledgeStopped)throw Error('rue_control_invalid_request');return (await client(argv)).resolveRuntimeRollout(argv.id,{expectedUpdatedAt:argv.expectedUpdatedAt,acknowledgeStopped:true})})})
 .command({command:'rollout <worker-id>',describe:'Request rollout of an already-built, immutable local runtime image; manager performs safe drain/install/verification',builder:z=>z.positional('worker-id',{type:'string',demandOption:true}).option('image',{type:'string',demandOption:true}).option('expected-image',{type:'string',demandOption:true}).option('expected-revision',{type:'number',demandOption:true}).option('request-id',{type:'string',demandOption:true}).option('acknowledge-host-execution',{type:'boolean',default:false}).option('wait',{type:'boolean',default:false}).option('timeout',{type:'number',default:1800,describe:'Maximum wait in seconds; timing out does not cancel the durable job'}),handler:handle(async argv=>{
  if(!uuid.test(argv.workerId)||!uuid.test(argv.requestId)||!digest.test(argv.image)||!digest.test(argv.expectedImage)||!Number.isSafeInteger(argv.expectedRevision)||argv.expectedRevision<0||!Number.isSafeInteger(argv.timeout)||argv.timeout<1||argv.timeout>3600||!argv.acknowledgeHostExecution)throw Error('rue_control_invalid_rollout_request')
  if(argv.wait&&process.env.PI_SESSION_ID)throw Error('rue_control_agent_wait_not_allowed')
  const api=await client(argv);submissions.add(argv)
  const job=await api.rolloutRuntime(argv.workerId,{image:argv.image,expectedImage:argv.expectedImage,expectedWorkerRevision:argv.expectedRevision,requestId:argv.requestId,acknowledgeHostExecution:true})
  const result=argv.wait?await waitForRuntimeRollout(()=>api.runtimeRollout(job.id),argv.timeout*1000):job
  if(['failed','uncertain'].includes(result.phase))process.exitCode=1
  return result
 })}).demandCommand(1).strict(),handler:()=>{},
}
