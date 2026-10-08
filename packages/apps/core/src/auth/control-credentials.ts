import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {controlApiOrigin} from '@multiterm/rue-sdk'
export interface ControlCredentialStore {get(origin:string):Promise<string|null>;set(origin:string,token:string):Promise<void>;remove(origin:string):Promise<void>}
type Run=(binary:string,args:string[],input?:string)=>Promise<{code:number;stdout:string}>
const validToken=(value:string)=>value.length===47&&/^tnk_[A-Za-z0-9_-]{43}$/.test(value)
/** Never include process stderr, command input or a credential in diagnostic messages. */
const run:Run=(binary,args,input)=>new Promise((resolve,reject)=>{
 const child=spawn(binary,args,{stdio:['pipe','pipe','ignore']}),chunks:Buffer[]=[];let bytes=0,settled=false
 const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();reject(Error('rue_control_credential_store_unavailable'))}
 const timer=setTimeout(fail,30_000)
 child.on('error',fail);child.stdin.on('error',()=>{});child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536)fail();else chunks.push(chunk)})
 child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);resolve({code:code??-1,stdout:Buffer.concat(chunks).toString('utf8')})})
 child.stdin.end(input)
})
/** Separate from provider credentials. No memory, plaintext-file, or env-secret fallback. */
export function createControlCredentialStore(platform:NodeJS.Platform=process.platform,execute:Run=run):ControlCredentialStore{
 const account=(origin:string)=>createHash('sha256').update(controlApiOrigin(origin)).digest('hex')
 function supported(){if(!['darwin','linux'].includes(platform)||(execute===run&&(process.env.CI||process.env.VITEST)))throw Error('rue_control_credential_store_unavailable')}
 async function get(origin:string){
  supported();const id=account(origin),result=platform==='darwin'?await execute('/usr/bin/security',['find-generic-password','-s','rue-control','-a',id,'-w']):await execute('/usr/bin/secret-tool',['lookup','service','rue-control','account',id])
  if(result.code===(platform==='darwin'?44:1))return null
  const value=result.stdout.trim();if(result.code!==0||!validToken(value))throw Error('rue_control_credential_store_unavailable')
  return value
 }
 return {get,async set(origin,token){
  supported();if(!validToken(token))throw Error('rue_control_credential_invalid')
  const id=account(origin)
  // macOS security's interactive input avoids placing the password in process arguments.
  const result=platform==='darwin'?await execute('/usr/bin/security',['-i'],`add-generic-password -U -s rue-control -a ${id} -w ${token}\n`):await execute('/usr/bin/secret-tool',['store','--label=Rue API control','service','rue-control','account',id],token)
  if(result.code!==0||await get(origin)!==token)throw Error('rue_control_credential_store_unavailable')
 },async remove(origin){
  supported();const id=account(origin),result=platform==='darwin'?await execute('/usr/bin/security',['delete-generic-password','-s','rue-control','-a',id]):await execute('/usr/bin/secret-tool',['clear','service','rue-control','account',id])
  if(![0,platform==='darwin'?44:1].includes(result.code)||await get(origin)!==null)throw Error('rue_control_credential_store_unavailable')
 }}
}
