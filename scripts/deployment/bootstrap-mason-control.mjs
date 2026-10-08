#!/usr/bin/env node
// One-time LOCAL operator bootstrap. Routine rollouts use the authenticated Rue API afterwards.
import {spawnSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {request} from 'node:http'
import {mkdirSync,openSync,closeSync,writeFileSync,readFileSync,lstatSync,rmSync} from 'node:fs'
import {homedir} from 'node:os'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {verifyMason,verifyPrivateVolume} from './mason-worker.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url)),context='colima-rue',volume='rue-mason-worker-private',alias='rue-worker:mason'
const digest=/^sha256:[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
// Use the highest API in our supported range, not the daemon's latest schema.
// Docker 29 requires at least 1.44; older engines can negotiate down to 1.41.
export function bootstrapApiPrefix(maximum,minimum){
 const parse=value=>typeof value==='string'&&/^1\.\d{1,3}$/.test(value)?Number(value.slice(2)):NaN
 const max=parse(maximum),min=parse(minimum),selected=Math.min(max,44)
 if(!Number.isInteger(max)||!Number.isInteger(min)||min>max||selected<Math.max(min,41))throw Error('bootstrap_engine_api_unsupported')
 return `/v1.${selected}`
}
export function bootstrapReadiness({workerId,apiOrigin,doctor,status,containers}){
 if(doctor?.workerId!==workerId||doctor?.apiOrigin!==apiOrigin)throw Error('bootstrap_worker_binding_mismatch')
 return status?.lastReported?.workerId===workerId&&status.lastReported.state==='connected'&&status.lastReported.desired==='draining'&&status.stale===false&&Array.isArray(containers)&&containers.length===0
}
export function replacementBody(inspected,image){
 if(!digest.test(image)||inspected?.Config?.Labels?.['com.docker.compose.project']!=='rue-mason'||inspected.Config.Labels['com.docker.compose.service']!=='worker'||inspected.HostConfig?.Privileged||inspected.HostConfig?.AutoRemove||!inspected.HostConfig?.ReadonlyRootfs||!inspected.HostConfig.CapDrop?.includes('ALL')||!inspected.HostConfig.SecurityOpt?.some(value=>value==='no-new-privileges'||value==='no-new-privileges:true'))throw Error('bootstrap_container_invalid')
 if(inspected.Mounts?.length!==2||!inspected.Mounts.some(m=>m.Type==='volume'&&m.Name===volume&&m.Destination==='/var/lib/rue-worker')||!inspected.Mounts.some(m=>m.Type==='bind'&&m.Source==='/var/run/docker.sock'&&m.Destination==='/var/run/docker.sock'))throw Error('bootstrap_mounts_invalid')
 if(inspected.Config.Env?.some(value=>value.startsWith('RUE_WORKER_AGENT_IMAGE=')))throw Error('bootstrap_remove_environment_image_override')
 const body={...inspected.Config,Image:image,Labels:{...inspected.Config.Labels},HostConfig:structuredClone(inspected.HostConfig),NetworkingConfig:{EndpointsConfig:Object.fromEntries(Object.entries(inspected.NetworkSettings?.Networks??{}).map(([name,value])=>[name,{Aliases:value.Aliases??[]}]))}}
 delete body.Hostname
 if(body.Labels['com.docker.compose.image'])body.Labels['com.docker.compose.image']=image
 return body
}
function privateDirectory(path){mkdirSync(path,{recursive:true,mode:0o700});const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077))throw Error('bootstrap_state_directory_not_private')}
async function main(){
 const {values}=parseArgs({options:{help:{type:'boolean'},'worker-id':{type:'string'},'api-url':{type:'string'},apply:{type:'boolean'},'acknowledge-host-execution':{type:'boolean'}},strict:true})
 if(values.help){console.log('Usage: node scripts/deployment/bootstrap-mason-control.mjs --worker-id UUID --api-url HTTPS_ORIGIN [--apply --acknowledge-host-execution]\nRun on Mason macOS. Without --apply this checks readiness only. Drain the host and stop its agents in Rue first; leave the manager running. No agents are automatically resumed.');return}
 if(process.platform!=='darwin')throw Error('bootstrap_run_on_mason_host_not_inside_agent')
 const workerId=values['worker-id'],apiOrigin=values['api-url'];if(!uuid.test(workerId??'')||!apiOrigin||new URL(apiOrigin).origin!==apiOrigin||!apiOrigin.startsWith('https://'))throw Error('bootstrap_target_required')
 if(values.apply&&!values['acknowledge-host-execution'])throw Error('bootstrap_explicit_consent_required')
 try{verifyMason();verifyPrivateVolume()}catch{throw Error('bootstrap_boundary_verification_failed')}
 const env={...process.env,DOCKER_CONTEXT:context,COLIMA_HOME:join(homedir(),'.colima'),XDG_CACHE_HOME:'/Volumes/MOTHERSHIP/.rue-colima-cache'};for(const key of ['DOCKER_HOST','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key]
 const run=(command,args,{log,timeout=60000}={})=>{const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout,maxBuffer:1048576,...(log!==undefined?{stdio:['ignore',log,log]}:{})});if(result.error||result.status!==0)throw Error('bootstrap_command_failed');return String(result.stdout??'').trim()}
 const docker=(args,options)=>run('docker',['--context',context,...args],options)
 const versions=docker(['version','--format','{{.Server.APIVersion}} {{.Server.MinAPIVersion}}']).split(/\s+/)
 const apiPrefix=bootstrapApiPrefix(versions[0],versions[1])
 const ids=docker(['ps','--all','--filter','label=com.docker.compose.project=rue-mason','--filter','label=com.docker.compose.service=worker','--format','{{.ID}}']).split('\n').filter(Boolean)
 if(ids.length!==1)throw Error('bootstrap_expected_one_manager')
 const inspected=JSON.parse(docker(['inspect',ids[0],'--format','{{json .}}']));replacementBody(inspected,inspected.Image)
 if(!inspected.State?.Running)throw Error('bootstrap_manager_must_be_running_for_preflight')
 const doctor=JSON.parse(docker(['exec',ids[0],'/usr/local/bin/rue-worker','doctor']))
 const status=()=>JSON.parse(docker(['exec',ids[0],'/usr/local/bin/rue-worker','status']))
 const scope=createHash('sha256').update(apiOrigin+'\0'+workerId).digest('hex')
 const containers=()=>docker(['ps','--all','--filter',`label=io.rue.scope=${scope}`,'--format','{{.ID}}']).split('\n').filter(Boolean)
 const initialStatus=status(),initialVersion=initialStatus?.lastReported?.version
 const ready=bootstrapReadiness({workerId,apiOrigin,doctor,status:initialStatus,containers:containers()})
 if(!values.apply){console.log(JSON.stringify({workerId,ready,required:'Drain this host and stop its agents in Rue; leave the manager running. Then repeat with --apply --acknowledge-host-execution.'},null,2));return}
 if(!ready)throw Error('bootstrap_host_must_be_drained_and_agents_stopped')
 const base=join(homedir(),'.local/state/rue/control-bootstrap');privateDirectory(base)
 const lock=join(base,'lock');mkdirSync(lock,{mode:0o700})
 const nonce=randomUUID(),directory=join(base,nonce);privateDirectory(directory);writeFileSync(join(lock,'owner'),nonce,{mode:0o600,flag:'wx'})
 const log=openSync(join(directory,'build.log'),'wx',0o600),journal=join(directory,'status.json')
 const record=(phase,extra={})=>writeFileSync(journal,JSON.stringify({workerId,apiOrigin,phase,at:new Date().toISOString(),...extra}),{mode:0o600})
 const socket=join(homedir(),'.colima/rue/docker.sock')
 const call=(method,path,body)=>new Promise((resolveCall,reject)=>{const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));const req=request({socketPath:socket,method,path:apiPrefix+path,headers:bytes?{'content-type':'application/json','content-length':bytes.length}:{}},res=>{const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>1048576)req.destroy();else chunks.push(chunk)});res.on('error',()=>reject(Error('bootstrap_engine_failed')));res.on('end',()=>{if((res.statusCode??500)>=300&&res.statusCode!==304){reject(Error(`bootstrap_engine_http_${res.statusCode??500}`));return}try{resolveCall(size?JSON.parse(Buffer.concat(chunks).toString('utf8')):null)}catch{reject(Error('bootstrap_engine_failed'))}})});const timer=setTimeout(()=>req.destroy(),60000);req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(Error('bootstrap_engine_failed')));req.end(bytes)})
 const name=inspected.Name.replace(/^\//,''),backup=`${name}-before-control-${nonce.slice(0,8)}`
 let oldStopped=false,newId,previousPolicy,workerImage,agentImage,policyChanged=false,committed=false
 const helper=fileURLToPath(new URL('./mason-worker.mjs',import.meta.url))
 const configure=(image,policy,enabled)=>run(process.execPath,[helper,'--configure-runtime','--agent-image',image,'--agent-limit',String(policy.capacity),...(policy.mothership?['--mothership']:[]),enabled?'--allow-runtime-rollouts':'--disable-runtime-rollouts'],{log})
 const waitConnected=async(id,after,expectedVersion,requireRollouts)=>{const deadline=Date.now()+180000;while(Date.now()<deadline){try{const v=JSON.parse(docker(['exec',id,'/usr/local/bin/rue-worker','status'])),s=v.lastReported;if(v.stale===false&&s?.state==='connected'&&s.workerId===workerId&&s.version===expectedVersion&&s.observedAt>=after){if(s.desired!=='draining')throw Error('bootstrap_host_no_longer_draining');if(!requireRollouts||(s.runtimeRollouts===true&&s.runtimeImage===agentImage))return}}catch(error){if(error.message==='bootstrap_host_no_longer_draining')throw error}await new Promise(resolve=>setTimeout(resolve,2000))}throw Error('bootstrap_manager_health_unconfirmed')}
 try{
  // Prove the chosen API works over the exact socket before any mutation.
  await call('GET','/version')
  record('building',{apiPrefix})
  const workerTag=`rue-worker:control-${nonce}`,agentTag=`rue-agent-runtime:control-${nonce}`
  docker(['buildx','build','--load','-f','deploy/worker/Dockerfile','-t',workerTag,'.'],{log,timeout:1200000})
  docker(['buildx','build','--load','-f','deploy/worker/agent.Dockerfile','-t',agentTag,'.'],{log,timeout:1200000})
  workerImage=docker(['image','inspect',workerTag,'--format','{{.Id}}']);agentImage=docker(['image','inspect',agentTag,'--format','{{.Id}}']);if(!digest.test(workerImage)||!digest.test(agentImage))throw Error('bootstrap_image_invalid')
  previousPolicy=JSON.parse(docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--mount',`type=volume,src=${volume},dst=/var/lib/rue-worker,readonly`,'--entrypoint','/usr/local/bin/rue-worker',workerImage,'runtime-policy']))
  if(previousPolicy.workerId!==workerId||previousPolicy.apiOrigin!==apiOrigin||!digest.test(previousPolicy.image??'')||!Number.isSafeInteger(previousPolicy.capacity)||previousPolicy.capacity<1)throw Error('bootstrap_policy_binding_mismatch')
  docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--entrypoint','node',agentImage,'-e',"const s=require('fs').readFileSync('/app/runner.js','utf8');process.exit(s.includes('credential-service network or timeout failure')&&s.includes('The agent stopped without a final reply')?0:1)"],{log})
  if(!bootstrapReadiness({workerId,apiOrigin,doctor,status:status(),containers:containers()}))throw Error('bootstrap_preflight_changed')
  record('prepared',{previousWorkerImage:inspected.Image,workerImage,agentImage,previousPolicy})
  oldStopped=true;await call('POST',`/containers/${ids[0]}/stop?t=20`)
  docker(['tag',workerImage,alias]);policyChanged=true;configure(agentImage,previousPolicy,true)
  record('configured',{previousWorkerImage:inspected.Image,workerImage,agentImage,previousPolicy})
  await call('POST',`/containers/${ids[0]}/rename?name=${encodeURIComponent(backup)}`)
  const replacement=replacementBody(inspected,workerImage);replacement.Labels['io.rue.control-bootstrap']=nonce
  const created=await call('POST',`/containers/create?name=${encodeURIComponent(name)}`,replacement);if(!/^[a-f0-9]{64}$/.test(created?.Id??''))throw Error('bootstrap_container_response_invalid');newId=created.Id
  const started=Date.now();await call('POST',`/containers/${newId}/start`)
  const expectedVersion=docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--entrypoint','/usr/local/bin/rue-worker',workerImage,'--version'])
  await waitConnected(newId,started,expectedVersion,true)
  if(containers().length)throw Error('bootstrap_agent_started_during_maintenance')
  committed=true
  let backupRetained=false;try{await call('DELETE',`/containers/${ids[0]}?v=0`)}catch{backupRetained=true}
  record('succeeded',{workerImage,agentImage,agentsResumed:false,backupRetained})
  console.log(JSON.stringify({state:'succeeded',workerId,workerImage,agentImage,agentsResumed:false,next:'Activate the host and resume intended agents in Rue. Future runtime rollouts can use the SDK/CLI.'},null,2))
 }catch(error){
  if(committed){console.log(JSON.stringify({state:'succeeded',workerId,workerImage,agentImage,agentsResumed:false,warning:'private_journal_update_failed'}));return}
  let restored=false
  try{
   // Never interrupt an agent that somebody started concurrently.
   if(oldStopped&&containers().length===0){
    if(!newId){try{const possible=await call('GET',`/containers/${encodeURIComponent(name)}/json`);if(possible.Config?.Labels?.['io.rue.control-bootstrap']===nonce)newId=possible.Id;else if(possible.Id!==inspected.Id)throw Error('bootstrap_container_name_changed')}catch(error){if(error.message==='bootstrap_container_name_changed')throw error}}
    if(newId){const inspectedNew=await call('GET',`/containers/${newId}/json`);if(inspectedNew.State?.Running){const current=JSON.parse(docker(['exec',newId,'/usr/local/bin/rue-worker','status']));if(current.lastReported?.desired&&current.lastReported.desired!=='draining')throw Error('bootstrap_host_no_longer_draining');await call('POST',`/containers/${newId}/stop?t=20`)}await call('DELETE',`/containers/${newId}?v=0`)}
    if(policyChanged)configure(previousPolicy.image,previousPolicy,previousPolicy.allowRuntimeRollouts===true)
    docker(['tag',inspected.Image,alias]);const original=await call('GET',`/containers/${ids[0]}/json`);if(original.Name.replace(/^\//,'')!==name)await call('POST',`/containers/${ids[0]}/rename?name=${encodeURIComponent(name)}`)
    const started=Date.now();await call('POST',`/containers/${ids[0]}/start`);await waitConnected(ids[0],started,initialVersion,false);restored=true
   }
  }catch{}
  record('failed',{rollbackVerified:restored,operatorReviewRequired:oldStopped&&!restored,cause:/^bootstrap_[a-z_0-9]+$/.test(error?.message)?error.message:'bootstrap_failed',apiPrefix})
  throw Error(oldStopped&&!restored?'bootstrap_failed_operator_review_required':'bootstrap_failed_original_manager_preserved')
 }finally{closeSync(log);if(readFileSync(join(lock,'owner'),'utf8')===nonce)rmSync(lock,{recursive:true})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(/^bootstrap_[a-z_]+$/.test(error.message)?error.message:'bootstrap_failed');process.exitCode=1})
