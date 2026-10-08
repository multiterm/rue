import {lstatSync,openSync,closeSync,unlinkSync} from 'node:fs'
import {join,resolve,isAbsolute} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {atomicState,privateDirectory,readPrivate} from './config.js'
/** Bootstrap using a Tenancy key; persist only an internal worker transport identity. */
export async function enrollKey(env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch){
 const origin=env.RUE_WORKER_API_URL,path=env.RUE_API_KEY_FILE,name=env.RUE_WORKER_NAME?.trim()
 if(!origin||!path||!isAbsolute(path)||!name||name.length>60||/[\x00-\x1f\x7f]/.test(name)||env.RUE_ACKNOWLEDGE_HOST_CONTROL!=='true')throw Error('worker_key_configuration_invalid')
 const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw Error('worker_https_origin_required')
 const directory=resolve(env.RUE_WORKER_STATE_DIR??'/var/lib/rue-worker');privateDirectory(directory)
 const lock=join(directory,'.key-enrollment.lock');let fd:number
 try{fd=openSync(lock,'wx',0o600)}catch{throw Error('worker_key_enrollment_locked')}
 try{
  try{lstatSync(join(directory,'link.json'));throw Error('worker_already_enrolled')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const token=readPrivate(path).trim();if(token.length!==47||!/^tnk_[A-Za-z0-9_-]{43}$/.test(token))throw Error('worker_key_invalid')
  const keyFingerprint=createHash('sha256').update(token).digest('hex')
  let intent:{origin:string;name:string;requestId:string;keyFingerprint:string}
  try{intent=JSON.parse(readPrivate(join(directory,'key-enrollment.json')))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('worker_key_intent_invalid');intent={origin,name,requestId:randomUUID(),keyFingerprint};atomicState(directory,'key-enrollment.json',intent)}
  if(intent.keyFingerprint!==keyFingerprint||intent.origin!==origin||intent.name!==name||!/^[a-f0-9-]{36}$/.test(intent.requestId))throw Error('worker_key_intent_conflict')
  const signal=AbortSignal.timeout(15000),response=await fetcher(origin+'/workers',{method:'POST',redirect:'error',cache:'no-store',signal,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({name,requestId:intent.requestId,acknowledgeHostControl:true})})
  if(!response.ok){await response.body?.cancel();throw Error('worker_key_enrollment_rejected')}
  const reader=response.body?.getReader();if(!reader)throw Error('worker_key_response_invalid');const chunks:Uint8Array[]=[];let size=0
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384||signal.aborted)throw Error('worker_key_response_invalid');chunks.push(part.value)}}finally{await reader.cancel();reader.releaseLock()}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8')),uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
  if(!uuid.test(result.worker?.id??'')||!uuid.test(result.worker?.keyAuthorityId??''))throw Error('worker_key_response_invalid')
  if(!result.secret)throw Error('worker_key_enrollment_recovery_required')
  if(typeof result.secret!=='string'||result.secret.length!==54||!/^rue_worker_[A-Za-z0-9_-]{43}$/.test(result.secret))throw Error('worker_key_response_invalid')
  atomicState(directory,'link.json',{origin,id:result.worker.id,secret:result.secret})
  return {id:result.worker.id}
 }finally{closeSync(fd);unlinkSync(lock)}
}
