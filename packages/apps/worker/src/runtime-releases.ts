import {arch} from 'node:os'
import {engineRequest} from './engine.js'
export interface RuntimeRelease {image:string;piVersion:string;createdAt:number}
export function localRuntimeRelease(value:any,filesystem:boolean|'workspace-roots',architecture=arch()):RuntimeRelease|undefined{
 const labels=value?.Config?.Labels,expected=architecture==='x64'?'amd64':architecture
 if(!/^sha256:[a-f0-9]{64}$/.test(value?.Id??'')||value.Os!=='linux'||value.Architecture!==expected||labels?.['io.rue.agent-runtime']!=='1'||(filesystem==='workspace-roots'?labels?.['io.rue.filesystem']!=='3':filesystem&&!['2','3'].includes(labels?.['io.rue.filesystem']))||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(labels?.['io.rue.pi-sdk']??''))return
 const createdAt=Date.parse(value.Created);if(!Number.isSafeInteger(createdAt)||createdAt<0)return
 return {image:value.Id,piVersion:labels['io.rue.pi-sdk'],createdAt}
}
/** Read-only inventory of local images. Never pull, build or execute a candidate. */
export async function localRuntimeReleases(socket:string,current:string,filesystem:boolean|'workspace-roots',signal:AbortSignal):Promise<RuntimeRelease[]>{
 const deadline=AbortSignal.any([signal,AbortSignal.timeout(8000)])
 const active=await engineRequest(socket,'GET',`/images/${current}/json`,undefined,deadline) as any
 const rows=await engineRequest(socket,'GET',`/images/json?filters=${encodeURIComponent(JSON.stringify({label:['io.rue.agent-runtime=1']}))}`,undefined,deadline) as any
 if(!Array.isArray(rows))throw Error('worker_runtime_inventory_invalid')
 const ids=[...new Set([current,...rows.sort((a,b)=>(b.Created??0)-(a.Created??0)).map(row=>row.Id)])].filter(id=>typeof id==='string'&&/^sha256:[a-f0-9]{64}$/.test(id)).slice(0,16)
 const releases:RuntimeRelease[]=[]
 for(const id of ids){
  const metadata=id===current?active:await engineRequest(socket,'GET',`/images/${id}/json`,undefined,deadline) as any
  if(['io.rue.mcp-tools','io.rue.compact','io.rue.codex-oauth'].some(key=>active?.Config?.Labels?.[key]==='1'&&metadata?.Config?.Labels?.[key]!=='1'))continue
  const release=localRuntimeRelease(metadata,filesystem);if(release)releases.push(release)
 }
 return releases.slice(0,8)
}
