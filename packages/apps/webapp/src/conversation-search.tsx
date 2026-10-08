import {useMemo} from 'react'
import type {RueMessage,RuePart} from '@multiterm/rue-sdk'
import {Button,Input} from '@multiterm/rue-ui'
export function ConversationSearch({messages,parts,value,onChange,onSelect}:{messages:RueMessage[];parts:RuePart[];value:string;onChange(value:string):void;onSelect(id:string):void}){
 const results=useMemo(()=>{
  const query=value.trim().toLocaleLowerCase();if(!query)return []
  const texts=new Map<string,string>()
  for(const part of [...parts].sort((a,b)=>a.seq-b.seq))if(!part.payload.superseded&&typeof part.payload.text==='string')texts.set(part.messageId,(texts.get(part.messageId)??'')+part.payload.text)
  return messages.flatMap(message=>{const text=texts.get(message.id)??'',index=text.toLocaleLowerCase().indexOf(query);return index<0?[]:[{message,text:text.slice(Math.max(0,index-50),index+150)}]})
 },[messages,parts,value])
 return <div className="grid gap-3"><Input autoFocus type="search" label="Search loaded history" aria-label="Search loaded history" placeholder="Search this conversation" maxLength={1000} show={{label:true,hideRequireType:true}} value={value} onChange={event=>onChange(event.target.value)}/>{value.trim()&&<><p role="status" className="text-sm text-muted">{results.length} {results.length===1?'match':'matches'}{results.length>50?' · showing first 50':''}</p><ul className="grid max-h-72 gap-1 overflow-auto" aria-label="Search results">{results.slice(0,50).map(({message,text})=><li key={message.id}><Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" onClick={()=>onSelect(message.id)}>{message.role==='user'?'You':message.role==='system'?'System':'Agent'}: {text}</Button></li>)}</ul></>}</div>
}
/** Tool/thinking snapshots may render as one card rather than one DOM row per chunk. */
export function searchMessageAnchor(id:string,parts:RuePart[]){
 const own=parts.filter(part=>part.messageId===id&&!part.payload.superseded)
 const kind=own.some(part=>part.type==='reasoning')?'reasoning':'tool'
 const identity=(part:RuePart)=>{const value=part.payload[kind];return value&&typeof value==='object'?value as {id?:string;chunk?:number}:undefined}
 const group=own.map(identity).find(value=>typeof value?.id==='string')
 if(!group)return id
 return parts.filter(part=>!part.payload.superseded&&identity(part)?.id===group.id).sort((a,b)=>(identity(a)?.chunk??0)-(identity(b)?.chunk??0))[0]?.messageId??id
}
