import {test} from 'node:test'
import assert from 'node:assert/strict'
import {remoteObservationRemaining} from '../packages/apps/webapp/src/remote-observation.ts'
import {createRueClient} from '../packages/libs/sdk/src/index.ts'
const now=100000,computer={status:'online',relayProtocol:2,serverNow:now,lastSeenAt:now-25000,leaseExpiresAt:now+35000,expiresAt:now+120000}
test('valid lease stays connected despite a heartbeat older than 20 seconds',()=>{assert.equal(remoteObservationRemaining(computer,now,now),35000)})
test('cached observations age and cannot outlive lease or connection expiry',()=>{assert.equal(remoteObservationRemaining(computer,now,now+5000),30000);assert.equal(remoteObservationRemaining(computer,now,now+35000),0);assert.equal(remoteObservationRemaining({...computer,expiresAt:now+2000},now,now+3000),0)})
test('server time is authoritative despite browser clock skew',()=>{assert.equal(remoteObservationRemaining(computer,900000,901000),34000)})
test('missing or invalid protocol 2 leases do not fall back to stale online state',()=>{for(const leaseExpiresAt of [null,undefined,NaN,Infinity,now-1])assert.equal(remoteObservationRemaining({...computer,leaseExpiresAt},now,now),0)})
test('explicit failure wins immediately; unknown agents never appear connected',()=>{for(const status of ['offline','revoked','expired','disconnected','unconfirmed'])assert.equal(remoteObservationRemaining({...computer,status},now,now),0);assert.equal(remoteObservationRemaining(undefined),0)})
test('legacy observations use the server legacy heartbeat deadline',()=>{assert.equal(remoteObservationRemaining({...computer,relayProtocol:1},now,now),5000);assert.equal(remoteObservationRemaining({...computer,relayProtocol:1},now,now+5000),0)})
test('status requests disable caching and combine caller cancellation with a ten-second timeout',async t=>{
 const timeout=new AbortController(),caller=new AbortController()
 t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,10000);return timeout.signal})
 const client=createRueClient({baseUrl:'https://rue.test',fetch:async(url,init)=>{assert.equal(init.cache,'no-store');assert.equal(init.signal.aborted,false);caller.abort();assert.equal(init.signal.aborted,true);return Response.json({computers:[]})}})
 await client.remoteComputers(caller.signal)
})
test('a stalled status check rejects on timeout rather than staying pending forever',async t=>{
 const timeout=new AbortController()
 t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,10000);queueMicrotask(()=>timeout.abort(new DOMException('Timed out','TimeoutError')));return timeout.signal})
 const client=createRueClient({baseUrl:'https://rue.test',fetch:async(url,init)=>{init.signal.throwIfAborted();return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}))}})
 await assert.rejects(client.remoteComputers(),{name:'TimeoutError'})
})
