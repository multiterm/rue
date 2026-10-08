import {createHash} from 'node:crypto'
import {mkdirSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync,constants,fstatSync} from 'node:fs'
import {join} from 'node:path'
import type {BridgeState} from '../../../../extensions/rue/bridge.ts'
/** A new boot never adopts an old process's command authority. Mirrors retain
 * their idempotency IDs; fenced command bookkeeping is archived, not replayed. */
export function recoverOutbox(saved:BridgeState|undefined,directory:string):BridgeState['outbox']{
 if(!saved)return []
 const interrupted=saved.outbox.filter(entry=>entry.kind==='output')
 if(interrupted.length){
  mkdirSync(directory,{recursive:true,mode:0o700})
  const st=lstatSync(directory)
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077))throw Error('agent_recovery_storage_invalid')
  const data=JSON.stringify(interrupted)+'\n',name=createHash('sha256').update(data).digest('hex')+'.json'
  let fd:number
  try{fd=openSync(join(directory,name),'wx',0o600)}catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
   const previous=openSync(join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW)
   try{const stat=fstatSync(previous);if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid?.()||stat.size!==Buffer.byteLength(data)||readFileSync(previous,'utf8')!==data)throw Error('agent_recovery_storage_invalid')}finally{closeSync(previous)}
   return saved.outbox.filter(entry=>entry.kind!=='output')
  }
  try{writeFileSync(fd,data);fsyncSync(fd)}finally{closeSync(fd)}
 }
 return saved.outbox.filter(entry=>entry.kind!=='output')
}
