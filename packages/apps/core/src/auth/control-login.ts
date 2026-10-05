import {randomBytes,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {z} from 'zod'
import {createRueClient,controlApiOrigin,CLI_LOGIN_TIMEOUT_MS,CLI_LOGIN_KEY_TTL_MS,type RuePlatformAccess} from '@multiterm/rue-sdk'
import type {ControlCredentialStore} from './control-credentials.js'
const callbackSchema=z.object({state:z.string().length(43),token:z.string().length(47).regex(/^tnk_[A-Za-z0-9_-]{43}$/),subject:z.string().min(1).max(512),keyId:z.string().min(3).max(128)}).strict()
export async function startControlLogin(input:{apiOrigin:string;webOrigin:string;store:ControlCredentialStore;fetch?:typeof fetch;timeoutMs?:number}){
 const apiOrigin=controlApiOrigin(input.apiOrigin),webOrigin=controlApiOrigin(input.webOrigin),state=randomBytes(32).toString('base64url'),requestId=randomUUID()
 const timeout=input.timeoutMs??CLI_LOGIN_TIMEOUT_MS
 if(!Number.isInteger(timeout)||timeout<1||timeout>CLI_LOGIN_TIMEOUT_MS)throw Error('rue_auth_timeout_invalid')
 let resolve!:(access:RuePlatformAccess)=>void,reject!:(error:Error)=>void,claimed=false,finished=false,requests=0
 const result=new Promise<RuePlatformAccess>((yes,no)=>{resolve=yes;reject=no})
 // A caller may still be displaying the approval URL when cancellation arrives.
 void result.catch(()=>{})
 let timer:ReturnType<typeof setTimeout>|undefined
 const stop=()=>{clearTimeout(timer);server.close();server.closeAllConnections()}
 const fail=(code:string)=>{if(finished)return;finished=true;stop();reject(Error(code))}
 const server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff')
  const address=server.address(),host=typeof address==='object'&&address?`127.0.0.1:${address.port}`:''
  if(req.headers.host!==host||req.url!=='/callback'||req.headers.origin!==webOrigin){res.writeHead(403).end();return}
  res.setHeader('access-control-allow-origin',webOrigin);res.setHeader('vary','Origin')
  if(++requests>32){res.writeHead(429).end();return}
  if(req.method==='OPTIONS'){
   if(req.headers['access-control-request-method']!=='POST'||String(req.headers['access-control-request-headers']??'').toLowerCase()!=='content-type'){res.writeHead(403).end();return}
   res.setHeader('access-control-allow-methods','POST');res.setHeader('access-control-allow-headers','content-type');res.setHeader('access-control-allow-private-network','true');res.writeHead(204).end();return
  }
  if(req.method!=='POST'||req.headers['content-type']!=='application/json'){res.writeHead(415).end();return}
  if(claimed||finished){res.writeHead(409).end();return}
  try{
   let size=0;const chunks:Buffer[]=[]
   for await(const chunk of req){size+=chunk.length;if(size>4096){res.writeHead(413).end();return}chunks.push(chunk)}
   const value=callbackSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
   if(!value.success||value.data.state!==state){res.writeHead(400).end();return}
   if(claimed||finished){res.writeHead(409).end();return}
   claimed=true
   const access=await createRueClient({baseUrl:apiOrigin,token:value.data.token,fetch:(url,init)=>(input.fetch??fetch)(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)})}).platformAccess()
   if(access.key.owner.type!=='self'||access.key.owner.subject!==value.data.subject||access.key.resourceOwner!==value.data.subject||access.key.id!==value.data.keyId||!Number.isSafeInteger(access.key.expiresAt)||access.key.expiresAt<=Date.now()||access.key.expiresAt>Date.now()+CLI_LOGIN_KEY_TTL_MS+30000)throw Error('invalid')
   if(finished)throw Error('expired')
   // No callback secret is stored until the API independently verifies its identity.
   await input.store.set(apiOrigin,value.data.token)
   // Cancellation during an OS write is unconfirmed; never delete another
   // concurrent login's key. The browser revokes this issued key on failed delivery.
   if(finished)return
   finished=true;clearTimeout(timer);res.writeHead(204).end();resolve(access);server.close()
  }catch{
   if(!claimed){res.writeHead(400).end();return}
   res.writeHead(400).end();finished=true;clearTimeout(timer);server.close();reject(Error('rue_auth_login_failed'))
  }
 })
 server.requestTimeout=15_000;server.headersTimeout=10_000
 await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',no);yes()})})
 const address=server.address();if(!address||typeof address==='string'){stop();throw Error('rue_auth_listener_failed')}
 const expiresAt=Date.now()+timeout,callback=`http://127.0.0.1:${address.port}/callback`
 const url=new URL('/cli-login',webOrigin);url.hash=new URLSearchParams({apiOrigin,callback,state,requestId,expiresAt:String(expiresAt)}).toString()
 timer=setTimeout(()=>fail('rue_auth_login_timed_out'),timeout)
 return {url:url.toString(),code:state.slice(0,8),result,cancel:()=>fail('rue_auth_login_cancelled')}
}
