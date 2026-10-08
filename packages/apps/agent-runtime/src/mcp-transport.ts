import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {JSONRPCMessageSchema,type JSONRPCMessage} from '@modelcontextprotocol/sdk/types.js'
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js'
/** MCP stdio framing with bounded buffers and no shell, inherited secrets, or stderr logging. */
export class BoundedStdioTransport implements Transport {
 onclose?:()=>void;onerror?:(error:Error)=>void;onmessage?:Transport['onmessage']
 private child?:ChildProcessWithoutNullStreams;private buffer=Buffer.alloc(0);private closed=false
 constructor(private command:string,private args:string[],private environment:Record<string,string>,private cwd:string){}
 async start(){
  if(this.child||this.closed)throw Error('agent_mcp_transport_unavailable')
  const child=spawn(this.command,this.args,{cwd:this.cwd,shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',...this.environment}})
  this.child=child;child.stderr.resume()
  child.stdin.on('error',()=>this.fail())
  child.stdout.on('data',(chunk:Buffer)=>{
   if(this.closed)return
   if(this.buffer.length+chunk.length>1048576){this.fail();return}
   this.buffer=Buffer.concat([this.buffer,chunk])
   let end:number
   while((end=this.buffer.indexOf(10))>=0){
    const line=this.buffer.subarray(0,end);this.buffer=this.buffer.subarray(end+1)
    try{this.onmessage?.(JSONRPCMessageSchema.parse(JSON.parse(line.toString('utf8'))))}catch{this.fail();return}
   }
  })
  child.once('exit',()=>{void this.close()})
  await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>{this.fail();reject(Error('agent_mcp_transport_unavailable'))})})
 }
 private fail(){if(this.closed)return;this.onerror?.(Error('agent_mcp_protocol_failed'));void this.close()}
 async send(message:JSONRPCMessage){
  const child=this.child,data=JSON.stringify(message)+'\n'
  if(this.closed||!child||Buffer.byteLength(data)>1048576||child.stdin.writableLength>1048576)throw Error('agent_mcp_transport_unavailable')
  await new Promise<void>((resolve,reject)=>child.stdin.write(data,error=>error?reject(Error('agent_mcp_transport_unavailable')):resolve()))
 }
 async close(){
  if(this.closed)return
  this.closed=true;this.buffer=Buffer.alloc(0);const child=this.child
  child?.stdin.destroy();child?.stdout.destroy();child?.stderr.destroy()
  const kill=(signal:NodeJS.Signals)=>{try{if(child?.pid){if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal)}}catch{}}
  kill('SIGTERM')
  if(child&&child.exitCode===null){const timer=setTimeout(()=>kill('SIGKILL'),1000);timer.unref();child.once('exit',()=>clearTimeout(timer))}
  this.onclose?.()
 }
}
