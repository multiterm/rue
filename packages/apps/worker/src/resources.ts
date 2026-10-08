import {readFileSync,statfsSync} from 'node:fs'
import {freemem,totalmem} from 'node:os'
export const MINIMUM_FREE_DISK_BYTES=1024**3
export function admissionResources(freeDiskBytes:number|null,requested:number,totalBytes:number,availableBytes:number){
 const valid=freeDiskBytes!==null&&Number.isSafeInteger(freeDiskBytes)&&freeDiskBytes>=0
 const blockedBy=!valid?'resource_probe_failed':freeDiskBytes<MINIMUM_FREE_DISK_BYTES?'disk_pressure':memoryBoundCapacity(requested,totalBytes,availableBytes)===0?'memory_pressure':null
 return {freeDiskBytes:valid?freeDiskBytes:null,minimumFreeDiskBytes:MINIMUM_FREE_DISK_BYTES,blockedBy} as const
}
export function probeAdmissionResources(stateDir:string,requested=DEFAULT_AGENT_LIMIT){
 let freeDiskBytes:number|null=null
 try{const disk=statfsSync(stateDir);freeDiskBytes=disk.bavail*disk.bsize}catch{}
 return admissionResources(freeDiskBytes,requested,totalmem(),hostAvailableMemory())
}
export const DEFAULT_AGENT_LIMIT=10
export const HOST_MEMORY_HEADROOM=2*1024**3
export const AGENT_START_HEADROOM=512*1024**2
/** Ceilings, not reservations. Idle agents share available host memory. */
export const AGENT_RESOURCES={Memory:4*1024**3,MemorySwap:4*1024**3,NanoCpus:2_000_000_000,PidsLimit:256} as const
export const LEGACY_AGENT_RESOURCES={Memory:512*1024**2,MemorySwap:512*1024**2,NanoCpus:500_000_000,PidsLimit:64} as const
export const AGENT_TMP_BYTES=512*1024**2
export const LEGACY_AGENT_TMP_BYTES=64*1024**2
export function resourceProfile(host:Record<string,unknown>|undefined){
 if(!host)return undefined
 if(Object.entries(AGENT_RESOURCES).every(([key,value])=>host[key]===value))return 'current'
 if(Object.entries(LEGACY_AGENT_RESOURCES).every(([key,value])=>host[key]===value))return 'legacy'
 return undefined
}
/** Linux MemAvailable includes reclaimable cache, unlike os.freemem(). */
export function hostAvailableMemory(){
 try{const value=readFileSync('/proc/meminfo','utf8').match(/^MemAvailable:\s+(\d+) kB$/m);if(value){const bytes=Number(value[1])*1024;if(Number.isSafeInteger(bytes)&&bytes>=0)return bytes}}catch{}
 return freemem()
}
/** Admission gate only: never evict running agents when memory drops.
 * The supervisor serializes boots and rechecks actual headroom before each start.
 * This permits overcommit of ceilings, not a guarantee against workload-driven OOM.
 */
export function memoryBoundCapacity(requested:number,totalBytes:number,availableBytes:number){
 if(!Number.isSafeInteger(requested)||requested<1||!Number.isFinite(totalBytes)||!Number.isFinite(availableBytes)||availableBytes>totalBytes||availableBytes<HOST_MEMORY_HEADROOM+AGENT_START_HEADROOM)return 0
 return requested
}
