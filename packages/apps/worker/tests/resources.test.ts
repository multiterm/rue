import {expect,test} from 'vitest'
import {AGENT_RESOURCES,LEGACY_AGENT_RESOURCES,AGENT_TMP_BYTES,resourceProfile,memoryBoundCapacity} from '../src/resources.js'
test('new runtimes get bounded build-capable resources and legacy runtimes remain recognizable',()=>{
 expect(AGENT_RESOURCES.Memory).toBe(4294967296)
 expect(AGENT_RESOURCES.NanoCpus).toBe(2000000000)
 expect(AGENT_TMP_BYTES).toBe(536870912)
 expect(resourceProfile(AGENT_RESOURCES)).toBe('current')
 expect(resourceProfile(LEGACY_AGENT_RESOURCES)).toBe('legacy')
 expect(resourceProfile({...AGENT_RESOURCES,Memory:0})).toBeUndefined()
 expect(resourceProfile({...AGENT_RESOURCES,MemorySwap:-1})).toBeUndefined()
 expect(resourceProfile({...AGENT_RESOURCES,NanoCpus:0})).toBeUndefined()
})
test('shared-memory admission keeps headroom without treating ceilings as reservations',()=>{
 expect(memoryBoundCapacity(10,8*1024**3,6*1024**3)).toBe(10)
 expect(memoryBoundCapacity(10,16*1024**3,12*1024**3)).toBe(10)
 expect(memoryBoundCapacity(1,16*1024**3,12*1024**3)).toBe(1)
 expect(memoryBoundCapacity(2,2*1024**3,1024**3)).toBe(0)
 expect(memoryBoundCapacity(2,16*1024**3,512*1024**2)).toBe(0)
})
