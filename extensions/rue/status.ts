import {gitReader,type GitStatus} from './git-status.ts'
import type {AgentCatalog} from './runtime-info.ts'
export interface AgentStatus {
 git?:GitStatus|null
 piVersion?:string|null;catalog?:AgentCatalog;catalogHash?:string
 version:1;cwd:string;branch:string|null;state:'idle'|'working'|'compacting';provider:string|null;model:string|null;thinking:string|null
 context:{tokens:number|null;window:number|null;percent:number|null}
 usage:{input:number;output:number;cacheRead:number;cacheWrite:number;costUsd:number}
 cacheHitPercent:number|null;subscription:boolean|null;autoCompaction:boolean|null
}
const text=(value:unknown,max:number)=>{if(typeof value!=='string')return null;const clean=value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,'');return clean.length>max?clean.slice(0,max-1)+'…':clean}
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.min(value,Number.MAX_SAFE_INTEGER):null
/** Allowlisted counters only. Deliberately never serializes entries, auth or model objects. */
export function agentStatus(source:{cwd:string;branch:string|null;git?:GitStatus|null;idle:boolean;compacting?:boolean;model?:{provider:string;id:string;contextWindow:number};thinking:string;context?:{tokens:number|null;contextWindow:number;percent:number|null};entries:readonly unknown[];subscription?:boolean;autoCompaction?:boolean;runtime?:{piVersion:string|null;catalog:AgentCatalog;catalogHash?:string}}):AgentStatus{
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,costUsd:0};let cacheHitPercent:number|null=null
 for(const raw of source.entries){
  if(!raw||typeof raw!=='object')continue
  const entry=raw as {type?:string;message?:{role?:string;usage?:any};usage?:any}
  const value=entry.type==='message'&&['assistant','toolResult'].includes(entry.message?.role??'')?entry.message?.usage:['compaction','branch_summary'].includes(entry.type??'')?entry.usage:undefined
  if(!value)continue
  for(const field of ['input','output','cacheRead','cacheWrite'] as const)usage[field]=Math.min(Number.MAX_SAFE_INTEGER,usage[field]+(number(value[field])??0))
  usage.costUsd=Math.min(Number.MAX_SAFE_INTEGER,usage.costUsd+(number(value.cost?.total)??0))
  if(entry.type==='message'&&entry.message?.role==='assistant'){
   const total=(number(value.input)??0)+(number(value.cacheRead)??0)+(number(value.cacheWrite)??0)
   cacheHitPercent=total>0?100*(number(value.cacheRead)??0)/total:null
  }
 }
 return {...source.runtime,...(source.git!==undefined?{git:source.git}:{}),version:1,cwd:text(source.cwd,1024)??'',branch:text(source.branch,256),state:source.compacting?'compacting':source.idle?'idle':'working',provider:text(source.model?.provider,128),model:text(source.model?.id,128),thinking:text(source.thinking,32),context:{tokens:number(source.context?.tokens),window:number(source.context?.contextWindow??source.model?.contextWindow),percent:number(source.context?.percent)},usage,cacheHitPercent,subscription:source.subscription??null,autoCompaction:source.autoCompaction??null}
}
/** Share the same bounded local snapshot between legacy branch and Git metadata. */
export function branchReader(){
 const read=gitReader()
 return Object.assign((cwd:string)=>read(cwd)?.branch??null,{git:read})
}
