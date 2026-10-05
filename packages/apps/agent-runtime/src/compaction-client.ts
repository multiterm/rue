import {z} from 'zod'
const command=z.object({id:z.string().uuid(),status:z.enum(['queued','assigned','running','succeeded','failed','cancelled','uncertain'])})
const claim=z.discriminatedUnion('execute',[z.object({execute:z.literal(false),command}),z.object({execute:z.literal(true),command,nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),serverNow:z.number().int(),deadline:z.number().int()})])
export function compactionClient(origin:string,id:string,token:string,instance:string,fetcher:typeof fetch=fetch){
 async function post(action:string,body:object,signal:AbortSignal){
  const response=await fetcher(`${origin}/terminal-client/${encodeURIComponent(id)}/compactions/${action}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({instance,...body}),signal,cache:'no-store',redirect:'error'})
  if(!response.ok){await response.body?.cancel();throw Error('agent_compaction_transport_failed')}
  const reader=response.body?.getReader();if(!reader)throw Error('agent_compaction_transport_failed')
  const chunks:Uint8Array[]=[];let size=0
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384||signal.aborted)throw Error('agent_compaction_transport_failed');chunks.push(part.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  if(signal.aborted)throw Error('agent_compaction_transport_failed')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
 }
 return {
  poll:async(signal:AbortSignal)=>z.object({commands:z.array(command).max(1)}).parse(await post('poll',{},signal)).commands,
  claim:async(id:string,signal:AbortSignal)=>{const result=claim.parse(await post('claim',{commandId:id},signal));if(result.command.id!==id||result.execute&&result.command.status!=='running')throw Error('agent_compaction_response_invalid');return result},
  acknowledge:async(id:string,nonce:string,outcome:'succeeded'|'failed',signal:AbortSignal)=>{const result=command.parse(await post('ack',{commandId:id,nonce,outcome},signal));if(result.id!==id||result.status!==outcome)throw Error('agent_compaction_response_invalid')},
 }
}
