import type {RueMessage,RuePart} from '@multiterm/rue-sdk'
type Identity={id:string;chunk:number}
const identity=(part:RuePart,reasoning:boolean)=>(reasoning?part.payload.reasoning:part.payload.tool) as Identity|undefined
const groupKey=(id:string,reasoning:boolean)=>`${reasoning?'reasoning':'tool'}:${id}`
/** Resolve transport chunks once, omitting superseded placeholders and duplicate
 * cards before date grouping. Work is proportional to parts plus sorting, not
 * messages × all parts. No transcript text is discarded or truncated. */
export function indexTranscript(messages:RueMessage[],parts:RuePart[]){
 const own=new Map<string,RuePart[]>(),groups=new Map<string,RuePart[]>()
 for(const part of parts){const list=own.get(part.messageId)??[];list.push(part);own.set(part.messageId,list)
  if(part.payload.superseded)continue
  for(const reasoning of [false,true]){const id=identity(part,reasoning)?.id;if(!id)continue;const key=groupKey(id,reasoning),group=groups.get(key)??[];group.push(part);groups.set(key,group)}
 }
 for(const [key,group] of groups)group.sort((a,b)=>identity(a,key.startsWith('reasoning:'))!.chunk-identity(b,key.startsWith('reasoning:'))!.chunk)
 const rows:Array<{message:RueMessage;parts:RuePart[]}>=[]
 for(const message of messages){const all=own.get(message.id)??[],live=all.filter(p=>!p.payload.superseded).sort((a,b)=>a.seq-b.seq)
  if(all.length&&!live.length)continue
  const reasoning=live.some(p=>p.type==='reasoning'),id=live.map(p=>identity(p,reasoning)).find(Boolean)?.id,group=id?groups.get(groupKey(id,reasoning)):undefined
  if(group?.length&&group[0]!.messageId!==message.id)continue
  rows.push({message,parts:group?[...new Set([...all,...group])]:all})
 }
 return rows
}
