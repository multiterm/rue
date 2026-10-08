import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseRememberedAuth,rememberedAuthStore,rememberedAuthKey,sdkSessionKey} from '../packages/apps/webapp/src/remembered-auth.ts'
const saved={kind:'keyname',tokens:{token:'synthetic-token',refreshToken:'synthetic-refresh',record:{subject:'usr_test',userEmail:'test@example.test',principalType:'user',expiresAt:1}}}
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}
test('keeps expired access tokens with refresh credentials for server-authorized renewal',()=>{
 assert.deepEqual(parseRememberedAuth(JSON.stringify(saved)),saved)
 for(const value of ['broken',JSON.stringify({kind:'keyname',tokens:{token:'untrusted'}}),JSON.stringify({...saved,tokens:{...saved.tokens,record:{...saved.tokens.record,principalType:'machine'}}})])assert.equal(parseRememberedAuth(value),null)
 assert.notEqual(rememberedAuthKey('https://api.keyname.dev'),rememberedAuthKey('https://other.example.test'))
})
test('cold start restores only SDK tokens, never OAuth state; logout removes both storage copies',()=>{
 const previous=globalThis.window,localStorage=storage(),sessionStorage=storage();globalThis.window={localStorage,sessionStorage}
 try{
  const store=rememberedAuthStore('https://api.keyname.dev');store.save(saved)
  sessionStorage.setItem('keyname.auth.state.v1','tab-bound-state')
  store.restoreSdk(store.read())
  assert.deepEqual(JSON.parse(sessionStorage.getItem(sdkSessionKey)),saved.tokens)
  assert.equal(sessionStorage.getItem('keyname.auth.state.v1'),'tab-bound-state')
  store.clear();assert.equal(store.read(),null);assert.equal(sessionStorage.getItem(sdkSessionKey),null)
 }finally{globalThis.window=previous}
})
test('blocked browser storage does not break sign-in helpers',()=>{
 const previous=globalThis.window;globalThis.window={get localStorage(){throw Error('blocked')},get sessionStorage(){throw Error('blocked')}}
 try{const store=rememberedAuthStore('https://api.keyname.dev');assert.equal(store.read(),null);store.save(saved);store.clear();assert.equal(store.legacyCredential(),null)}finally{globalThis.window=previous}
})
