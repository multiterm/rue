import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {openDatabase} from '../../src/storage/db.js'
import {requestTerminalPairing,approveTerminalPairing,exchangeTerminalPairing,activateTerminalConnection} from '../../src/storage/terminal-pairing.js'
import {attachComputer,validateRelaySocket} from '../../src/storage/terminal-relay.js'
import {clearProviderKeyGrants,saveProviderKey} from '../../src/storage/provider-keys.js'
import {agentApiKey,decryptCredential} from '../../src/storage/agent-settings.js'
import {delegatedOAuthAccess,grantProviderOAuth,providerOAuthMetadata,removeProviderOAuth,saveProviderOAuth,validateCodexCredential,type CodexCredential} from '../../src/storage/provider-oauth.js'
let db:ReturnType<typeof openDatabase>
beforeEach(()=>{vi.stubEnv('RUE_SETTINGS_ENCRYPTION_KEY',randomBytes(32).toString('base64'));db=openDatabase(':memory:')})
afterEach(()=>{db.close();vi.unstubAllEnvs();vi.restoreAllMocks()})
const credential=(ttl=120000,accountId='account_one',refresh='refresh-never-in-output'):CodexCredential=>({type:'oauth',access:[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({exp:Math.floor((Date.now()+ttl)/1000),'https://api.openai.com/auth':{chatgpt_account_id:accountId}})).toString('base64url'),'synthetic-signature'].join('.'),refresh,expires:Date.now()+ttl,accountId})
function terminal(owner='alice',database=db){const verifier=randomBytes(32).toString('base64url'),pending=requestTerminalPairing(database,createHash('sha256').update(verifier).digest('hex'),randomUUID()),{code}=approveTerminalPairing(database,pending.requestId,owner,'Pi'),linked=exchangeTerminalPairing(database,pending.requestId,verifier,code);activateTerminalConnection(database,linked.token);const instance=randomUUID();attachComputer(database,linked.token,linked.id,instance,Date.now(),2);return {...linked,current:()=>validateRelaySocket(database,linked.token,linked.id,instance).ownerSubject===owner}}
function setup(ttl=-1000){const target=terminal();saveProviderOAuth(db,'alice',0,credential(ttl));grantProviderOAuth(db,'alice',1,target.id,true);return target}
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise<unknown>(done=>{resolve=done});return {promise,resolve}}
test('OAuth is encrypted under a distinct owner/provider scope, metadata and audit contain no secrets',()=>{
 const value=credential();saveProviderOAuth(db,'alice',0,value);saveProviderKey(db,'alice','openai',0,'separate-api-key')
 const metadata=providerOAuthMetadata(db,'alice');expect(metadata).toMatchObject({credentialType:'oauth',configured:true,state:'ready',revision:1})
 const stored=db.prepare('SELECT * FROM provider_oauth_credentials').get() as {encrypted_credential:string}
 for(const text of [JSON.stringify(stored),JSON.stringify(metadata),JSON.stringify(db.prepare('SELECT * FROM provider_key_audit').all())]){expect(text).not.toContain(value.access);expect(text).not.toContain(value.refresh)}
 expect(()=>decryptCredential(db,['bob','provider-oauth','openai-codex'],stored.encrypted_credential)).toThrow()
 expect(providerOAuthMetadata(db,'bob').configured).toBe(false);expect(agentApiKey(db,'alice')).toBe('separate-api-key')
 expect(()=>saveProviderOAuth(db,'alice',0,value)).toThrow('oauth_credential_changed')
})
test('invalid credentials are rejected without leaking inputs or treating claims as Rue identity',()=>{
 for(const value of [{type:'api_key',key:'private-key'}, {...credential(),accountId:'other'}, {...credential(),access:'sensitive-invalid-access'}])expect(()=>validateCodexCredential(value)).toThrow('oauth_credential_invalid')
})
test('delegation requires owner, live target, grant and live caller authority; refresh never reaches caller',async()=>{
 const own=terminal(),other=terminal('bob'),issued=credential();saveProviderOAuth(db,'alice',0,issued)
 expect(()=>grantProviderOAuth(db,'alice',1,other.id,true)).toThrow('oauth_target_unavailable')
 const refresh=vi.fn();await expect(delegatedOAuthAccess(db,'alice',own.id,own.current,refresh)).rejects.toThrow('oauth_not_granted')
 grantProviderOAuth(db,'alice',1,own.id,true)
 await expect(delegatedOAuthAccess(db,'alice',own.id,()=>false,refresh)).rejects.toThrow('oauth_authority_expired')
 const result=await delegatedOAuthAccess(db,'alice',own.id,own.current,refresh)
 expect(Object.keys(result).sort()).toEqual(['accessToken','credentialType','expiresAt','provider']);expect(result.accessToken).toBe(issued.access);expect(refresh).not.toHaveBeenCalled()
})
test('concurrent callers share exactly one rotation',async()=>{
 const own=setup(),pending=deferred(),refresh=vi.fn(()=>pending.promise),next=credential(180000,'account_one','rotated-refresh')
 const a=delegatedOAuthAccess(db,'alice',own.id,own.current,refresh),b=delegatedOAuthAccess(db,'alice',own.id,own.current,refresh)
 await Promise.resolve();expect(refresh).toHaveBeenCalledTimes(1);expect(providerOAuthMetadata(db,'alice').state).toBe('refreshing')
 pending.resolve(next);expect((await a).accessToken).toBe(next.access);expect((await b).accessToken).toBe(next.access)
 const value=db.prepare('SELECT encrypted_credential FROM provider_oauth_credentials').get() as {encrypted_credential:string}
 expect(JSON.parse(decryptCredential(db,['alice','provider-oauth','openai-codex'],value.encrypted_credential)).refresh).toBe('rotated-refresh')
})
test('grant revocation during refresh blocks delivery without losing a rotated token',async()=>{
 const own=setup(),pending=deferred(),access=delegatedOAuthAccess(db,'alice',own.id,own.current,()=>pending.promise)
 grantProviderOAuth(db,'alice',2,own.id,false);pending.resolve(credential())
 await expect(access).rejects.toThrow('oauth_not_granted');expect(providerOAuthMetadata(db,'alice').state).toBe('ready')
})
test('lease authority is checked again after rotation',async()=>{
 const own=setup(),pending=deferred();let live=true
 const access=delegatedOAuthAccess(db,'alice',own.id,()=>live,()=>pending.promise);live=false;pending.resolve(credential())
 await expect(access).rejects.toThrow('oauth_authority_expired')
})
test.each(['remove','replace'] as const)('%s during refresh fences a late result and clears grants',async action=>{
 const own=setup(),pending=deferred(),access=delegatedOAuthAccess(db,'alice',own.id,own.current,()=>pending.promise)
 if(action==='remove')removeProviderOAuth(db,'alice',2);else saveProviderOAuth(db,'alice',2,credential(180000,'new_account'))
 pending.resolve(credential());await expect(access).rejects.toThrow('oauth_reauthorization_required')
 expect(providerOAuthMetadata(db,'alice')).toMatchObject({state:action==='remove'?'removed':'ready',revision:3})
 expect(db.prepare("SELECT * FROM provider_key_grants WHERE provider='openai-codex'").all()).toEqual([])
})
test('uncertain refresh is redacted, durable and never automatically retried',async()=>{
 const own=setup(),refresh=vi.fn(async()=>{throw Error('sensitive-provider-response')})
 await expect(delegatedOAuthAccess(db,'alice',own.id,own.current,refresh)).rejects.toThrow('oauth_reauthorization_required')
 await expect(delegatedOAuthAccess(db,'alice',own.id,own.current,refresh)).rejects.toThrow('oauth_reauthorization_required')
 expect(refresh).toHaveBeenCalledTimes(1);expect(providerOAuthMetadata(db,'alice').state).toBe('reauthorize')
})
test('a refresh cannot switch the connected provider account',async()=>{
 const own=setup();await expect(delegatedOAuthAccess(db,'alice',own.id,own.current,async()=>credential(180000,'other_account'))).rejects.toThrow('oauth_reauthorization_required')
})
test('identity reset clears OAuth grants and advances metadata revision',async()=>{
 const own=setup(180000);clearProviderKeyGrants(db,'alice',{type:'terminal',id:own.id})
 expect(providerOAuthMetadata(db,'alice').revision).toBe(3)
 await expect(delegatedOAuthAccess(db,'alice',own.id,own.current,vi.fn())).rejects.toThrow('oauth_not_granted')
})
test('independent DB handles cannot double-refresh a durable claim',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'rue-oauth-test-')),path=join(directory,'test.sqlite'),a=openDatabase(path),b=openDatabase(path)
 try{const own=terminal('alice',a);saveProviderOAuth(a,'alice',0,credential(-1000));grantProviderOAuth(a,'alice',1,own.id,true)
 const pending=deferred(),refresh=vi.fn(()=>pending.promise),first=delegatedOAuthAccess(a,'alice',own.id,own.current,refresh)
 await expect(delegatedOAuthAccess(b,'alice',own.id,own.current,refresh)).rejects.toThrow('oauth_refresh_in_progress')
 pending.resolve(credential());await first;expect(refresh).toHaveBeenCalledTimes(1)
 a.prepare("UPDATE provider_oauth_credentials SET state='refreshing',refresh_nonce='interrupted',refresh_started_at=?").run(Date.now()-7000)
 expect(providerOAuthMetadata(b,'alice').state).toBe('reauthorize')
 await expect(delegatedOAuthAccess(b,'alice',own.id,own.current,refresh)).rejects.toThrow('oauth_reauthorization_required');expect(refresh).toHaveBeenCalledTimes(1)
 }finally{a.close();b.close();rmSync(directory,{recursive:true,force:true})}
})
test('deadline fences an adapter that ignores cancellation and discards its late result',async()=>{
 const own=setup(),pending=deferred(),access=delegatedOAuthAccess(db,'alice',own.id,own.current,()=>pending.promise)
 await expect(access).rejects.toThrow('oauth_reauthorization_required');pending.resolve(credential());await Promise.resolve()
 expect(providerOAuthMetadata(db,'alice').state).toBe('reauthorize')
},10000)
