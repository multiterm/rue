import {createHash} from 'node:crypto'
export interface AgentCatalog {providers:Array<{id:string;name:string;credentialMode:'api_key'|'oauth'|'unsupported';models:Array<{id:string;name:string;contextWindow:number}>}>;truncated:boolean}
const clean=(s:string)=>s.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,'')
/** Copy only public identifiers and display metadata. Never serialize native provider/model objects. */
export function runtimeInfo(piVersion:unknown,models:readonly {provider:string;id:string;name?:string;contextWindow:number}[],providers:readonly {id:string;name:string;auth?:{apiKey?:unknown;oauth?:unknown}}[]=[]):{piVersion:string|null;catalog:AgentCatalog;catalogHash:string}{
 const catalog:AgentCatalog={providers:[],truncated:false},groups=new Map<string,AgentCatalog['providers'][number]>(),seen=new Set<string>();let bytes=0,count=0
 const names=new Map(providers.map(p=>[p.id,clean(p.name).slice(0,128)]))
 for(const model of models){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model.provider)||!model.id||model.id.length>128||clean(model.id)!==model.id||!Number.isSafeInteger(model.contextWindow)||model.contextWindow<0){catalog.truncated=true;continue}
  const key=JSON.stringify([model.provider,model.id]);if(seen.has(key))continue
  const value={id:model.id,name:clean(model.name??model.id).slice(0,128),contextWindow:model.contextWindow},size=Buffer.byteLength(JSON.stringify(value))+256
  if(count>=4096||bytes+size>384*1024||(!groups.has(model.provider)&&groups.size>=128)){catalog.truncated=true;continue}
  seen.add(key);bytes+=size;count++
  let group=groups.get(model.provider);if(!group){group={id:model.provider,name:names.get(model.provider)||model.provider,credentialMode:model.provider==='openai-codex'?'oauth':providers.find(p=>p.id===model.provider)?.auth?.apiKey?'api_key':'unsupported',models:[]};groups.set(model.provider,group);catalog.providers.push(group)}
  group.models.push(value)
 }
 return {catalogHash:createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),piVersion:typeof piVersion==='string'&&/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(piVersion)&&piVersion.length<=64?piVersion:null,catalog}
}
