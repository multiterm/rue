import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkManagedPromptCredentials} from '../packages/apps/webapp/src/managed-prompt-preflight.ts'
import {runtimeFailureMessage} from '../packages/apps/agent-runtime/src/turn-outcome.ts'
function fixture(){
 const session={id:'session',ownerSubject:'owner',terminalConnectionId:'connection',meta:{managedAgentId:'agent'}}
 const agent={id:'agent',sessionId:'session',connectionId:'connection',desired:'running',config:{provider:'openai'}}
 const keys={ownerSubject:'owner',keyStorageAvailable:true,keys:[{provider:'openai',configured:true,grants:[{type:'terminal',id:'connection'}]}]}
 const client={managedAgents:async()=>({agents:[agent]}),providerKeys:async()=>keys}
 return {session,agent,keys,client,check:()=>checkManagedPromptCredentials(client,session,'owner',()=>true)}
}
test('matching explicit grant passes using metadata only',async()=>{await fixture().check()})
test('new bot with saved key but no grant is blocked before sending',async()=>{const f=fixture();f.keys.keys[0].grants=[];await assert.rejects(f.check(),/Saving a key alone/);assert.deepEqual(f.keys.keys[0].grants,[])})
test('worker and another terminal grants cannot authorize a new bot',async()=>{for(const grant of [{type:'worker',id:'connection'},{type:'terminal',id:'previous-connection'}]){const f=fixture();f.keys.keys[0].grants=[grant];await assert.rejects(f.check(),/explicitly grant/)}})
test('missing provider key and unavailable vault have actionable errors',async()=>{let f=fixture();f.keys.keys[0].configured=false;await assert.rejects(f.check(),/configure a saved credential/);f=fixture();f.keys.keyStorageAvailable=false;await assert.rejects(f.check(),/storage is unavailable/)})
test('owner, session and connection mismatches fail closed',async()=>{
 for(const change of [f=>f.keys.ownerSubject='other',f=>f.session.ownerSubject='other',f=>f.agent.sessionId='other',f=>f.agent.connectionId='other',f=>f.agent.id='other']){const f=fixture();change(f);await assert.rejects(f.check())}
})
test('account or bot switching during metadata fetch prevents send',async()=>{const f=fixture();let current=true;f.client.providerKeys=async()=>{current=false;return f.keys};await assert.rejects(checkManagedPromptCredentials(f.client,f.session,'owner',()=>current),/changed/)})
test('lookup outage fails closed without exposing server error contents',async()=>{const f=fixture();f.client.providerKeys=async()=>{throw Error('private service details')};await assert.rejects(f.check(),error=>error.message.includes('No request was sent')&&!error.message.includes('private'))})
test('unmanaged sessions do not require shared grants',async()=>{const f=fixture();f.session.meta={};f.client.providerKeys=async()=>assert.fail('unmanaged must not query grants');await f.check()})
test('Codex requires its own OAuth grant, not an OpenAI API key',async()=>{const f=fixture();f.agent.config.provider='openai-codex';await assert.rejects(f.check(),/not a Codex OAuth grant/);f.keys.oauth={ownerSubject:'owner',configured:true,keyStorageAvailable:true,runtimeSupported:true,state:'ready',grants:[]};await assert.rejects(f.check(),/explicitly grant/);f.keys.oauth.grants=[{type:'terminal',id:'connection'}];await f.check();for(const state of ['refreshing','reauthorize','removed']){f.keys.oauth.state=state;await assert.rejects(f.check(),/reconnect/)}})
test('stopped bots are not ready even with grants',async()=>{const f=fixture();f.agent.desired='stopped';await assert.rejects(f.check(),/not ready/)})
test('runtime preserves context errors, accepts thrown strings, redacts credentials',()=>{assert.equal(runtimeFailureMessage(Error('Your input exceeds the context window.')),'Your input exceeds the context window.');assert.equal(runtimeFailureMessage('Provider unavailable'),'Provider unavailable');assert.ok(!runtimeFailureMessage(Error('Authorization: Bearer private-value')).includes('private-value'))})
test('unknown errors do not blame keys or claim tools were not run',()=>{for(const error of [undefined,{},Error(''),Error('{"secret":"private"}')]){const text=runtimeFailureMessage(error);assert.match(text,/runtime diagnostics/);assert.match(text,/Some tools may already have run/);assert.doesNotMatch(text,/AI-key|private/)}})
