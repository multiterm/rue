import {randomUUID} from 'node:crypto'
export interface UsageEvent{eventId:string;provider:string;model:string;credentialId:string|null;time:number;input:number;output:number;cacheRead:number;cacheWrite:number;costUsd:number|null}
export function usageEvent(message:unknown,credentialId:string|null):UsageEvent|undefined{
 const m=message as {provider?:string;model?:string;usage?:Record<string,any>}
 if(!m||typeof m.provider!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(m.provider)||typeof m.model!=='string'||!m.model||m.model.length>256||!m.usage)return
 const values=['input','output','cacheRead','cacheWrite'].map(key=>m.usage![key]??0)
 if(values.some(value=>!Number.isSafeInteger(value)||value<0||value>1e12))return
 const cost=m.provider==='openai-codex'?null:m.usage.cost?.total
 return {eventId:randomUUID(),provider:m.provider,model:m.model,credentialId,time:Date.now(),input:values[0],output:values[1],cacheRead:values[2],cacheWrite:values[3],costUsd:typeof cost==='number'&&Number.isFinite(cost)&&cost>=0&&cost<=1e6?cost:null}
}
