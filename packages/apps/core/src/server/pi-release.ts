const endpoint='https://registry.npmjs.org/-/package/@earendil-works%2fpi-coding-agent/dist-tags'
let cached:{latestVersion:string|null;checkedAt:number|null}={latestVersion:null,checkedAt:null},retryAt=0,pending:Promise<typeof cached>|undefined
/** Public release metadata only. No credentials, caller URLs, redirects, installation or code execution. */
export function latestPiRelease(fetcher:typeof fetch=fetch,now=Date.now()):Promise<typeof cached>{
 if(now<retryAt)return Promise.resolve(cached)
 if(pending)return pending
 pending=(async()=>{
  await Promise.resolve()
  try{
   const response=await fetcher(endpoint,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{accept:'application/json'}})
   if(!response.ok){await response.body?.cancel();throw Error('registry_unavailable')}
   const reader=response.body?.getReader();if(!reader)throw Error('registry_unavailable')
   let text='',size=0;const decoder=new TextDecoder()
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8192)throw Error('registry_response_too_large');text+=decoder.decode(part.value,{stream:true})}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
   const version=JSON.parse(text+decoder.decode()).latest
   if(typeof version!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version))throw Error('registry_version_invalid')
   cached={latestVersion:version,checkedAt:now}
  }catch{/* Keep last successful metadata, never claim an unknown installation is up to date. */}
  finally{retryAt=now+300000;pending=undefined}
  return cached
 })()
 return pending
}
