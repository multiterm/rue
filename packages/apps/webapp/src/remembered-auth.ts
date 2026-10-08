import type {KeynameTokenSet} from '@multiterm/rue-auth'
export const sdkSessionKey='keyname.auth.tokens.v1'
export const credentialSessionKey='rue.credential-session'
export type RememberedAuth={kind:'keyname'|'credential';tokens:KeynameTokenSet}
export function rememberedAuthKey(api:string){return `rue.auth.remembered.v1:${new URL(api).origin}`}
export function parseRememberedAuth(value:string|null):RememberedAuth|null{
 try{
  if(!value||value.length>65536)return null
  const data=JSON.parse(value) as RememberedAuth,record=data.tokens?.record
  if(!['keyname','credential'].includes(data.kind)||typeof data.tokens?.token!=='string'||!data.tokens.token||!record||typeof record.subject!=='string'||!record.subject||record.principalType!=='user')return null
  if(data.tokens.refreshToken!==undefined&&typeof data.tokens.refreshToken!=='string')return null
  return data
 }catch{return null}
}
export function authStorageGet(storage:Storage,key:string){try{return storage.getItem(key)}catch{return null}}
export function authStorageSet(storage:Storage,key:string,value:string|null){try{if(value===null)storage.removeItem(key);else storage.setItem(key,value)}catch{/* Private browsing/quota restrictions must not prevent in-memory sign-in. */}}
export function browserAuthStorage(kind:'localStorage'|'sessionStorage'):Storage|undefined{try{return window[kind]}catch{return undefined}}
export function rememberedAuthStore(api:string){
 const key=rememberedAuthKey(api),local=browserAuthStorage('localStorage'),session=browserAuthStorage('sessionStorage')
 const get=(storage:Storage|undefined,name:string)=>storage?authStorageGet(storage,name):null
 const set=(storage:Storage|undefined,name:string,value:string|null)=>{if(storage)authStorageSet(storage,name,value)}
 return {
  key,
  read(){return parseRememberedAuth(get(local,key))},
  save(value:RememberedAuth){const text=JSON.stringify(value);if(parseRememberedAuth(text))set(local,key,text)},
  restoreSdk(value:RememberedAuth){if(value.kind==='keyname')set(session,sdkSessionKey,JSON.stringify(value.tokens))},
  sdk(){try{return JSON.parse(get(session,sdkSessionKey)??'null') as KeynameTokenSet|null}catch{return null}},
  legacyCredential(){try{const old=JSON.parse(get(session,credentialSessionKey)??'null');return old?parseRememberedAuth(JSON.stringify({kind:'credential',tokens:{token:old.token,record:{...old.user,principalType:'user'}}})):null}catch{return null}},
  clearSdk(){set(session,sdkSessionKey,null)},
  clear(){set(local,key,null);set(session,sdkSessionKey,null);set(session,credentialSessionKey,null)},
 }
}
