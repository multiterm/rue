import type {RueMessage,RuePart} from '@multiterm/rue-sdk'
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)
const id=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=128
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
export function transcriptUpsert(value:unknown):{sessionId:string;message:RueMessage;parts:RuePart[]}|undefined{
 if(!object(value)||!id(value.sessionId)||!object(value.upsert))return
 const {message,parts}=value.upsert
 if(!object(message)||message.sessionId!==value.sessionId||!id(message.id)||typeof message.role!=='string'||!['user','assistant','system'].includes(message.role)||!integer(message.seq)||!integer(message.time)||!object(message.meta)||!Array.isArray(parts)||parts.length>64)return
 if(parts.some(p=>!object(p)||p.sessionId!==value.sessionId||p.messageId!==message.id||!id(p.id)||typeof p.type!=='string'||!integer(p.seq)||!object(p.payload)||(p.payload.mirrorVersion!==undefined&&!integer(p.payload.mirrorVersion))))return
 return {sessionId:value.sessionId as string,message:message as unknown as RueMessage,parts:parts as RuePart[]}
}
const version=(p:RuePart|undefined)=>typeof p?.payload.mirrorVersion==='number'?p.payload.mirrorVersion:0
export function upsertMessages(current:RueMessage[]|undefined,updates:RueMessage[]){
 const ids=new Set(current?.map(m=>m.id)),additions=updates.filter(m=>!ids.has(m.id))
 return additions.length?[...(current??[]),...additions].sort((a,b)=>a.seq-b.seq):current??[]
}
export function upsertParts(current:RuePart[]|undefined,updates:RuePart[]){
 const next=new Map(current?.map(p=>[p.id,p]));let changed=false
 for(const p of updates){const old=next.get(p.id);if(!old||version(p)>version(old)||(version(p)===version(old)&&p.payload.mirrorFinal===true&&old.payload.mirrorFinal!==true)){next.set(p.id,p);changed=true}}
 return changed?[...next.values()]:current??[]
}
/** Carry only pushes received DURING a snapshot read. Earlier cached rows must
 * not override an authoritative read (e.g. after server recovery or deletion). */
export function reconcileMessages(snapshot:RueMessage[],before:RueMessage[]|undefined,after:RueMessage[]|undefined){
 const ids=new Set(before?.map(m=>m.id));return upsertMessages(snapshot,(after??[]).filter(m=>!ids.has(m.id)))
}
export function reconcileParts(snapshot:RuePart[],before:RuePart[]|undefined,after:RuePart[]|undefined){
 const previous=new Map(before?.map(p=>[p.id,p]))
 return upsertParts(snapshot,(after??[]).filter(p=>p!==previous.get(p.id)))
}
