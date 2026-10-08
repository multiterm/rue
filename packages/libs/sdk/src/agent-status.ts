/** Last-reported Pi metadata, not provider credentials or an execution grant. */
export interface RueAgentStatus {
 git?:{branch:string|null;remote:string|null;localBranches:string[];truncated:boolean}|null
 piVersion?:string|null
 catalogHash?:string
 catalog?:{providers:Array<{id:string;name:string;credentialMode:'api_key'|'oauth'|'unsupported';models:Array<{id:string;name:string;contextWindow:number}>}>;truncated:boolean}
 version:1;cwd:string;branch:string|null;state:'idle'|'working'|'compacting';provider:string|null;model:string|null;thinking:string|null
 context:{tokens:number|null;window:number|null;percent:number|null}
 usage:{input:number;output:number;cacheRead:number;cacheWrite:number;costUsd:number}
 cacheHitPercent:number|null;subscription:boolean|null;autoCompaction:boolean|null
}
