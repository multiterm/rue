import {test} from 'node:test'
import assert from 'node:assert/strict'
import {admissionResources,MINIMUM_FREE_DISK_BYTES} from '../../worker/src/resources.ts'
import {workerHealthSchema} from '../src/storage/workers.ts'
const GiB=1024**3
const health={version:'0.3.0',platform:'linux',architecture:'arm64',dockerAvailable:true,acceptingWork:false,freeMemoryBytes:8*GiB,cpus:8,capabilities:['host-health-v1']}
test('disk admission reports the outage threshold without weakening the gate',()=>{
 assert.equal(admissionResources(712572*1024,10,12*GiB,8*GiB).blockedBy,'disk_pressure')
 assert.equal(admissionResources(MINIMUM_FREE_DISK_BYTES,10,12*GiB,8*GiB).blockedBy,null)
 assert.equal(admissionResources(20*GiB,10,12*GiB,GiB).blockedBy,'memory_pressure')
 for(const value of [null,NaN,-1,Infinity])assert.equal(admissionResources(value,10,12*GiB,8*GiB).blockedBy,'resource_probe_failed')
})
test('health accepts old managers and bounded resource reports but rejects paths and invalid values',()=>{
 assert.equal(workerHealthSchema.safeParse(health).success,true)
 const resources=admissionResources(712572*1024,10,12*GiB,8*GiB)
 assert.equal(workerHealthSchema.safeParse({...health,resources}).success,true)
 assert.equal(workerHealthSchema.safeParse({...health,resources:{...resources,path:'/private'}}).success,false)
 assert.equal(workerHealthSchema.safeParse({...health,resources:{...resources,freeDiskBytes:-1}}).success,false)
 assert.equal(workerHealthSchema.safeParse({...health,resources:{...resources,blockedBy:'arbitrary'}}).success,false)
})
