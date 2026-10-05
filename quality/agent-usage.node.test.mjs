import {test} from 'node:test'
import assert from 'node:assert/strict'
import {providerWithBroker} from '../extensions/rue/provider-keys.ts'
import {usageEvent} from '../extensions/rue/usage.ts'
import {Bridge} from '../extensions/rue/bridge.ts'
const message={provider:'openai',model:'test-model',usage:{input:12,output:3,cacheRead:5,cacheWrite:0,cost:{total:0.002}}}
test('request-level credential attribution survives rotation while a request is in flight',async()=>{
 const reports=[],pending=[]
 let key='first-secret',credentialId='key_'+'a'.repeat(64)
 const base={id:'openai',name:'OpenAI',auth:{apiKey:{resolve:async()=>undefined}},getModels:()=>[],stream(){return this.streamSimple()},streamSimple(){const result=new Promise(resolve=>pending.push(resolve));return {result:()=>result}}}
 const provider=providerWithBroker(base,async()=>({granted:true,apiKey:key,credentialId}),event=>reports.push(event))
 const auth=()=>provider.auth.apiKey.resolve({signal:new AbortController().signal})
 const first=await auth();provider.streamSimple({}, {},{apiKey:first.auth.apiKey})
 key='second-secret';credentialId='key_'+'b'.repeat(64)
 const second=await auth();provider.streamSimple({}, {},{apiKey:second.auth.apiKey})
 pending[1](message);pending[0](message);await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(reports.map(event=>event.credentialId),['key_'+'b'.repeat(64),'key_'+'a'.repeat(64)])
 assert.equal(new Set(reports.map(event=>event.eventId)).size,2)
 assert.ok(!JSON.stringify(reports).includes('secret'))
})
test('unknown local credentials remain unattributed; observer failures do not fail provider execution',async()=>{
 const base={id:'openai',name:'OpenAI',auth:{apiKey:{resolve:async()=>({auth:{apiKey:'local'}})}},getModels:()=>[],stream(){return this.streamSimple()},streamSimple(){return {result:async()=>message}}}
 let recorded
 const provider=providerWithBroker(base,async()=>{throw Error('Local auth must win')},event=>{recorded=event;throw Error('Telemetry storage failed')})
 const stream=provider.streamSimple({}, {},{apiKey:'local'});assert.deepEqual(await stream.result(),message)
 await new Promise(resolve=>setImmediate(resolve));assert.equal(recorded.credentialId,null)
})
test('usage uploads have an independent durable queue and never block transcript delivery',async()=>{
 const state={origin:'https://rue.test',token:'test',id:'term_test',piSessionId:'pi',outbox:[],shareStatus:true},notices=[]
 let failSave=false
 const bridge=new Bridge(state,{save(){if(failSave)throw Error('disk failure')}},{idle:()=>true,send(){},cancel(){},notify:text=>notices.push(text),confirm:async()=>false})
 bridge.usageSupported=true;bridge.watchdog=()=>true
 const event=usageEvent(message,null);bridge.recordUsage(event)
 assert.equal(state.usageOutbox.length,1);assert.equal(state.outbox.length,0)
 bridge.call=async()=>{throw Error('API offline')};await bridge.flushUsage()
 assert.equal(state.usageOutbox[0].eventId,event.eventId);assert.equal(bridge.stopped,false)
 bridge.usageRetryAt=0;bridge.call=async()=>({recorded:true});await bridge.flushUsage();assert.equal(state.usageOutbox.length,0)
 failSave=true;bridge.recordUsage(usageEvent(message,null));assert.equal(state.usageOutbox.length,0);assert.equal(bridge.stopped,false);assert.equal(notices.length,1)
 state.shareStatus=false;failSave=false;bridge.recordUsage(usageEvent(message,null));assert.equal(state.usageOutbox.length,0)
})
test('subscription cost remains unknown and invalid counters are not fabricated',()=>{
 assert.equal(usageEvent({...message,provider:'openai-codex'},null).costUsd,null)
 assert.equal(usageEvent({...message,usage:{...message.usage,input:-1}},null),undefined)
 assert.equal(usageEvent({...message,usage:{...message.usage,cost:{total:NaN}}},null).costUsd,null)
})
