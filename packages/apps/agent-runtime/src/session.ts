import {SessionManager} from '@earendil-works/pi-coding-agent'
import {existsSync,mkdirSync,lstatSync,openSync,readSync,writeFileSync,fsyncSync,fstatSync,closeSync,constants} from 'node:fs'
import {join,dirname} from 'node:path'
export function flushSession(file:string){
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid?.())throw Error('agent_session_binding_invalid');fsyncSync(fd)}finally{closeSync(fd)}
 const dir=openSync(dirname(file),constants.O_RDONLY|constants.O_NOFOLLOW)
 try{fsyncSync(dir)}finally{closeSync(dir)}
}
/** Pin identity and persist from the first user message, not first model reply. */
export function persistentSession(cwd:string,directory:string,id:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||id.length!==36)throw Error('agent_session_binding_invalid')
 mkdirSync(directory,{recursive:true,mode:0o700})
 if(lstatSync(directory).isSymbolicLink())throw Error('agent_session_binding_invalid')
 const file=join(directory,`${id}.jsonl`)
 if(!existsSync(file)){
  const initial=SessionManager.create(cwd,directory,{id})
  const fd=openSync(file,'wx',0o600)
  try{writeFileSync(fd,JSON.stringify(initial.getHeader())+'\n');fsyncSync(fd)}finally{closeSync(fd)}
 }
 const st=lstatSync(file)
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.uid!==process.getuid?.())throw Error('agent_session_binding_invalid')
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{
  const buffer=Buffer.alloc(4096),bytes=readSync(fd,buffer,0,buffer.length,0),line=buffer.subarray(0,bytes).toString('utf8').split('\n')[0]
  const header=JSON.parse(line)
  if(header.type!=='session'||header.id!==id||header.cwd!==cwd)throw Error('agent_session_binding_invalid')
 }finally{closeSync(fd)}
 const manager=SessionManager.open(file,directory)
 if(manager.getSessionId()!==id||manager.getCwd()!==cwd)throw Error('agent_session_binding_invalid')
 return manager
}
