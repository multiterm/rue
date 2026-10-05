import {z} from 'zod'
const identifier=z.string().min(3).max(128).regex(/^[A-Za-z0-9_-]+$/)
export const tenancyKeySchema=z.object({id:identifier,owner:z.discriminatedUnion('type',[z.object({type:z.literal('self'),subject:identifier}).strict(),z.object({type:z.literal('project'),organizationId:identifier,projectId:identifier}).strict()]),service:z.literal('rue'),grants:z.array(z.string().min(1).max(160).refine(v=>v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v))).min(1).max(64).refine(v=>new Set(v).size===v.length),name:z.string().max(120),createdAt:z.number().int(),expiresAt:z.number().int().positive(),revokedAt:z.null()}).strict()
export type TenancyKey=z.infer<typeof tenancyKeySchema>
export const keyResourceOwner=(key:Pick<TenancyKey,'owner'>)=>key.owner.type==='self'?key.owner.subject:`tenancy:project:${key.owner.organizationId}:${key.owner.projectId}`
export async function boundedJson(response:Response,signal:AbortSignal,max=32768):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max||signal.aborted)throw Error();chunks.push(part.value)}}finally{await reader.cancel();reader.releaseLock()}
 if(signal.aborted)throw Error();return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export async function verifyTenancyKey(origin:string,credential:string,token:string,fetcher:typeof fetch=fetch):Promise<TenancyKey|undefined>{
 if(!/^tnk_[A-Za-z0-9_-]{43}$/.test(token))return
 try{
  const signal=AbortSignal.timeout(8000),response=await fetcher(origin+'/v1/service/rue/keys/verify',{method:'POST',headers:{authorization:`Bearer ${credential}`,'x-tenancy-service':'rue','content-type':'application/json'},body:JSON.stringify({token}),redirect:'error',cache:'no-store',signal})
  if(!response.ok&&response.status!==401){await response.body?.cancel();throw Error()}
  const body=await boundedJson(response,signal) as {error?:string;key?:unknown}
  if(response.status===401){if(body.error==='TENANCY_API_KEY_INVALID')return;throw Error()}
  const key=tenancyKeySchema.parse(body.key);return key.expiresAt>Date.now()?key:undefined
 }catch{throw Error('tenancy_verification_unavailable')}
}
