import type {CommandModule} from 'yargs'
import {createRueClient,controlApiOrigin} from '@multiterm/rue-sdk'
import {createControlCredentialStore} from '../auth/control-credentials.js'
import {startControlLogin} from '../auth/control-login.js'
const origin=(argv:any)=>controlApiOrigin(String(argv.apiUrl??process.env.RUE_CONTROL_API_URL??''))
const output=(value:unknown)=>process.stdout.write(JSON.stringify(value,null,2)+'\n')
const handle=(run:(argv:any)=>Promise<void>)=>async(argv:any)=>{try{await run(argv)}catch(error){output({error:error instanceof Error&&/^rue_(auth|control)_[a-z_]+$/.test(error.message)?error.message:'rue_auth_request_failed'});process.exitCode=1}}
export const authCommand:CommandModule={
 command:'auth <command>',describe:'Browser approval and OS-stored Rue control credentials (separate from provider accounts)',
 builder:y=>y.option('api-url',{type:'string',describe:'HTTPS Rue API origin; or RUE_CONTROL_API_URL'})
 .command({command:'login',describe:'Approve a one-hour control key in a browser on this computer; no token copying',builder:z=>z.option('web-url',{type:'string',describe:'HTTPS Rue webapp origin; or RUE_CONTROL_WEB_URL'}),handler:handle(async argv=>{
  const apiOrigin=origin(argv),webOrigin=controlApiOrigin(String(argv.webUrl??process.env.RUE_CONTROL_WEB_URL??'')),store=createControlCredentialStore()
  await store.get(apiOrigin) // Fail before issuing a key if secure storage cannot be accessed.
  const login=await startControlLogin({apiOrigin,webOrigin,store}),cancel=()=>login.cancel()
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel)
  try{
   process.stderr.write(`Open this URL in a browser on this computer. Approve only if the code matches: ${login.code}\n${login.url}\n`)
   const access=await login.result;output({authenticated:true,apiOrigin,key:access.key})
  }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);login.cancel()}
 })})
 .command({command:'status',describe:'Verify the stored key against the API; does not print its secret',handler:handle(async argv=>{
  const apiOrigin=origin(argv),token=await createControlCredentialStore().get(apiOrigin)
  if(!token){output({authenticated:false,apiOrigin});return}
  const access=await createRueClient({baseUrl:apiOrigin,token,fetch:(url,init)=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)})}).platformAccess()
  output({authenticated:true,apiOrigin,key:access.key})
 })})
 .command({command:'logout',describe:'Remove this computer’s stored credential; revoke it separately in Rue Settings → API keys',handler:handle(async argv=>{
  const apiOrigin=origin(argv);await createControlCredentialStore().remove(apiOrigin);output({authenticated:false,apiOrigin,serverRevoked:false})
 })}).demandCommand(1).strict(),handler:()=>{},
}
