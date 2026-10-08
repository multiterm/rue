import {test} from 'node:test'
import assert from 'node:assert/strict'
import {bootstrapApiPrefix,bootstrapReadiness,replacementBody} from '../scripts/deployment/bootstrap-mason-control.mjs'
const workerId='12345678-1234-4234-8234-123456789012',apiOrigin='https://rue.test'
const original=()=>({Image:'sha256:'+'a'.repeat(64),Config:{Hostname:'old-container',Image:'rue-worker:mason',Env:['RUE_WORKER_STATE_DIR=/var/lib/rue-worker'],Labels:{'com.docker.compose.project':'rue-mason','com.docker.compose.service':'worker','com.docker.compose.image':'sha256:'+'a'.repeat(64)}},HostConfig:{Privileged:false,AutoRemove:false,ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],Memory:1073741824,NanoCpus:1000000000,Mounts:[{Type:'volume',Source:'rue-mason-worker-private',Target:'/var/lib/rue-worker'}]},Mounts:[{Type:'volume',Name:'rue-mason-worker-private',Destination:'/var/lib/rue-worker'},{Type:'bind',Source:'/var/run/docker.sock',Destination:'/var/run/docker.sock'}],NetworkSettings:{Networks:{'rue-mason_default':{Aliases:['worker']}}}})
test('API negotiation supports Docker 29 and rejects incompatible or malformed ranges',()=>{
 assert.equal(bootstrapApiPrefix('1.53','1.44'),'/v1.44')
 assert.equal(bootstrapApiPrefix('1.44','1.24'),'/v1.44')
 assert.equal(bootstrapApiPrefix('1.43','1.12'),'/v1.43')
 assert.equal(bootstrapApiPrefix('1.41','1.12'),'/v1.41')
 for(const [max,min] of [['1.53','1.45'],['1.40','1.12'],['1.44','1.53'],['2.0','1.44'],['bad','1.44'],['1.53',undefined]])assert.throws(()=>bootstrapApiPrefix(max,min),/engine_api_unsupported/)
})
test('bootstrap refuses live agents, non-drained/stale hosts and wrong enrollment bindings',()=>{
 const input={workerId,apiOrigin,doctor:{workerId,apiOrigin},status:{lastReported:{workerId,state:'connected',desired:'draining'},stale:false},containers:[]}
 assert.equal(bootstrapReadiness(input),true)
 assert.equal(bootstrapReadiness({...input,containers:['running-or-stopped-container']}),false)
 assert.equal(bootstrapReadiness({...input,status:{...input.status,stale:true}}),false)
 assert.equal(bootstrapReadiness({...input,status:{lastReported:{workerId,state:'connected',desired:'active'},stale:false}}),false)
 assert.throws(()=>bootstrapReadiness({...input,doctor:{workerId:'other',apiOrigin}}),/binding_mismatch/)
})
test('replacement preserves resources, private mounts and identity environment without mutating the original',()=>{
 const old=original(),snapshot=structuredClone(old),image='sha256:'+'b'.repeat(64),next=replacementBody(old,image)
 assert.equal(next.Image,image);assert.equal(next.Hostname,undefined)
 assert.deepEqual(next.Env,old.Config.Env);assert.deepEqual(next.HostConfig,old.HostConfig)
 assert.equal(next.Labels['com.docker.compose.image'],image)
 assert.deepEqual(next.NetworkingConfig.EndpointsConfig['rue-mason_default'].Aliases,['worker'])
 assert.deepEqual(old,snapshot)
})
test('replacement rejects foreign projects, unexpected binds, privilege changes and immutable-env overrides',()=>{
 assert.throws(()=>replacementBody(original(),'latest'),/container_invalid/)
 const foreign=original();foreign.Config.Labels['com.docker.compose.project']='other';assert.throws(()=>replacementBody(foreign,foreign.Image),/container_invalid/)
 const privileged=original();privileged.HostConfig.Privileged=true;assert.throws(()=>replacementBody(privileged,privileged.Image),/container_invalid/)
 const extra=original();extra.Mounts.push({Type:'bind',Source:'/private',Destination:'/private'});assert.throws(()=>replacementBody(extra,extra.Image),/mounts_invalid/)
 const env=original();env.Config.Env.push('RUE_WORKER_AGENT_IMAGE=sha256:'+'a'.repeat(64));assert.throws(()=>replacementBody(env,env.Image),/environment_image_override/)
})
