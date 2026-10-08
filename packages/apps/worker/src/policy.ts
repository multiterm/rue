import {validWorkspaceRoots,workspaceRoot} from '@multiterm/rue-sdk/filesystem'
import {DEFAULT_AGENT_LIMIT} from './resources.js'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {readPrivate,atomicState,type WorkerConfig} from './config.js'
import {engineRequest} from './engine.js'
export interface RuntimePolicy {origin:string;id:string;image:string;capacity:number;mothership?:boolean;allowRuntimeRollouts?:boolean;workspaceRoots?:string[]}
export function workspaceRootsFromEnvironment(env:NodeJS.ProcessEnv=process.env):string[]|undefined{
 if(env.RUE_WORKER_WORKSPACE_ROOTS===undefined)return
 try{const roots=JSON.parse(env.RUE_WORKER_WORKSPACE_ROOTS);if(validWorkspaceRoots(roots))return roots}catch{}
 throw Error('worker_runtime_policy_invalid')
}
function validate(value:RuntimePolicy,cfg:WorkerConfig){
 if(value?.workspaceRoots!==undefined&&(!validWorkspaceRoots(value.workspaceRoots)||!validWorkspaceRoots([...new Set([...(value.mothership?[workspaceRoot]:[]),...value.workspaceRoots])])))throw Error('worker_runtime_policy_invalid')
 if(value?.allowRuntimeRollouts!==undefined&&typeof value.allowRuntimeRollouts!=='boolean')throw Error('worker_runtime_policy_invalid')
 if(value?.mothership!==undefined&&typeof value.mothership!=='boolean')throw Error('worker_runtime_policy_invalid')
 if(!value||value.origin!==cfg.origin||value.id!==cfg.id||typeof value.image!=='string'||value.image.length!==71||!/^sha256:[a-f0-9]{64}$/.test(value.image)||!Number.isSafeInteger(value.capacity)||value.capacity<1)throw Error('worker_runtime_policy_invalid')
 return value
}
export function runtimePolicy(cfg:WorkerConfig,env:NodeJS.ProcessEnv=process.env):RuntimePolicy|undefined{
 if(env.RUE_WORKER_AGENT_IMAGE)return validate({origin:cfg.origin,id:cfg.id,image:env.RUE_WORKER_AGENT_IMAGE,capacity:Number(env.RUE_WORKER_AGENT_LIMIT??String(DEFAULT_AGENT_LIMIT)),mothership:env.RUE_WORKER_MOTHERSHIP==='true',workspaceRoots:workspaceRootsFromEnvironment(env)},cfg)
 try{return validate(JSON.parse(readPrivate(join(cfg.stateDir,'runtime-policy.json'))),cfg)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw Error('worker_runtime_policy_invalid')}
}
/** Operator-only, under the same kernel lock as run. Stop/destroy agents first. */
export async function configureRuntime(cfg:WorkerConfig,image:string,capacity=DEFAULT_AGENT_LIMIT,mothership=false,allowRuntimeRollouts=false,check:()=>void=()=>{},workspaceRoots?:string[]){
 check()
 const policy=validate({origin:cfg.origin,id:cfg.id,image,capacity,mothership,allowRuntimeRollouts,...(workspaceRoots!==undefined?{workspaceRoots}:{})},cfg)
 const metadata=await engineRequest(cfg.dockerSocket,'GET',`/images/${image}/json`) as any
 if(metadata?.Id!==image||metadata.Config?.Labels?.['io.rue.agent-runtime']!=='1'||(mothership&&!['2','3'].includes(metadata.Config?.Labels?.['io.rue.filesystem']))||(workspaceRoots?.length&&!['2','3'].includes(metadata.Config?.Labels?.['io.rue.filesystem'])))throw Error('worker_runtime_image_invalid')
 const scope=createHash('sha256').update(cfg.origin+'\0'+cfg.id).digest('hex')
 const containers=await engineRequest(cfg.dockerSocket,'GET','/containers/json?all=1&filters='+encodeURIComponent(JSON.stringify({label:[`io.rue.scope=${scope}`]})))
 if(!Array.isArray(containers)||containers.length)throw Error('worker_runtime_stop_agents_first')
 check()
 atomicState(cfg.stateDir,'runtime-policy.json',policy)
}
