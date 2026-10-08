import {z} from 'zod'
import {OAuthVaultError,validateCodexCredential,type CodexCredential} from '../storage/provider-oauth.js'
const AUTH='https://auth.openai.com',CLIENT_ID='app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_VERIFICATION_URL=AUTH+'/codex/device'
const text=z.string().min(1).max(16384)
const responseSchema=z.object({access_token:text,refresh_token:text,expires_in:z.number().int().positive().max(90*86400)})
async function post(path:string,body:URLSearchParams|Record<string,string>,signal:AbortSignal,fetcher:typeof fetch){
 signal.throwIfAborted()
 const response=await fetcher(AUTH+path,{method:'POST',redirect:'error',cache:'no-store',signal,headers:{'content-type':body instanceof URLSearchParams?'application/x-www-form-urlencoded':'application/json'},body:body instanceof URLSearchParams?body:JSON.stringify(body)})
 const reader=response.body?.getReader();if(!reader)throw Error()
 const chunks:Uint8Array[]=[];let size=0
 try{for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>49152)throw Error();chunks.push(part.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 signal.throwIfAborted()
 let data:unknown;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{data=null}
 return {status:response.status,ok:response.ok,data}
}
function credential(data:unknown){
 const tokens=responseSchema.parse(data),payload=JSON.parse(Buffer.from(tokens.access_token.split('.')[1]??'','base64url').toString('utf8'))
 return validateCodexCredential({type:'oauth',access:tokens.access_token,refresh:tokens.refresh_token,expires:Date.now()+tokens.expires_in*1000,accountId:payload?.['https://api.openai.com/auth']?.chatgpt_account_id})
}
export async function refreshCodexOAuth(value:CodexCredential,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<CodexCredential>{
 try{const input=validateCodexCredential(value),response=await post('/oauth/token',new URLSearchParams({grant_type:'refresh_token',client_id:CLIENT_ID,refresh_token:input.refresh}),signal,fetcher);if(!response.ok)throw Error();return credential(response.data)}catch{throw new OAuthVaultError(503,'oauth_refresh_failed')}
}
export type CodexDevice={deviceId:string;userCode:string;intervalMs:number}
export async function startCodexDevice(signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<CodexDevice>{
 try{
  const response=await post('/api/accounts/deviceauth/usercode',{client_id:CLIENT_ID},signal,fetcher);if(!response.ok)throw Error()
  const data=z.object({device_auth_id:z.string().min(1).max(2048),user_code:z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/),interval:z.union([z.number(),z.string()]).transform(Number).pipe(z.number().finite().min(0).max(60))}).parse(response.data)
  return {deviceId:data.device_auth_id,userCode:data.user_code,intervalMs:Math.max(5000,data.interval*1000)}
 }catch{throw new OAuthVaultError(503,'oauth_login_unavailable')}
}
/** One device poll, then at most one code exchange. A lost/uncertain exchange is
 * terminal for the login intent; callers must never retry it automatically. */
export async function pollCodexDevice(device:CodexDevice,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<{status:'pending'|'slow_down'}|{status:'review';credential:CodexCredential}>{
 try{
  const response=await post('/api/accounts/deviceauth/token',{device_auth_id:device.deviceId,user_code:device.userCode},signal,fetcher)
  if(!response.ok){
   const data=z.object({error:z.union([z.string(),z.object({code:z.string()})])}).safeParse(response.data)
   const error=data.success?typeof data.data.error==='string'?data.data.error:data.data.error.code:undefined
   if(error==='slow_down')return {status:'slow_down'}
   if(response.status===403||response.status===404||error==='deviceauth_authorization_pending')return {status:'pending'}
   throw Error()
  }
  const codes=z.object({authorization_code:z.string().min(1).max(4096),code_verifier:z.string().min(43).max(128).regex(/^[A-Za-z0-9_.~-]+$/)}).parse(response.data)
  const token=await post('/oauth/token',new URLSearchParams({grant_type:'authorization_code',client_id:CLIENT_ID,code:codes.authorization_code,code_verifier:codes.code_verifier,redirect_uri:AUTH+'/deviceauth/callback'}),signal,fetcher)
  if(!token.ok)throw Error()
  return {status:'review',credential:credential(token.data)}
 }catch{throw new OAuthVaultError(503,'oauth_login_failed')}
}
