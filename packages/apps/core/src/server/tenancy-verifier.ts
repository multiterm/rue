import {constants,openSync,fstatSync,readFileSync,closeSync} from 'node:fs'
import {isAbsolute} from 'node:path'
import {verifyTenancyKey,type TenancyKey} from './tenancy-keys.js'
// Storage projection for the internal delegated-authority ledger. It is not a
// public project-binding API or another credential type.
export type ProjectClaims={id:string;organizationId:string;projectId:string;service:'rue';scopes:string[];expiresAt:number;owner:TenancyKey['owner']}
export const asProjectClaims=(key:TenancyKey):ProjectClaims=>({id:key.id,organizationId:key.owner.type==='self'?'self':key.owner.organizationId,projectId:key.owner.type==='self'?key.owner.subject:key.owner.projectId,service:'rue',scopes:key.grants,expiresAt:key.expiresAt,owner:key.owner})
export interface ProjectVerifier {origin:string;verifyKey(token:string):Promise<TenancyKey|undefined>}
export function tenancyVerifier(origin:string,credential:string,fetcher:typeof fetch=fetch):ProjectVerifier{
 const url=new URL(origin)
 if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password||credential.length<32||credential.length>4096||/[\x00-\x20\x7f]/.test(credential))throw Error('tenancy_verifier_configuration_invalid')
 return {origin,verifyKey:token=>verifyTenancyKey(origin,credential,token,fetcher)}
}
/** Operator secret file only; never part of public config, browser state or grants. */
export function configuredTenancyVerifier():ProjectVerifier|undefined{
 const origin=process.env.RUE_TENANCY_ORIGIN,path=process.env.RUE_TENANCY_VERIFIER_FILE
 if(!origin&&!path)return
 if(!origin||!path||!isAbsolute(path))throw Error('tenancy_verifier_configuration_invalid')
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o077)||st.size>4097)throw Error('tenancy_verifier_configuration_invalid');return tenancyVerifier(origin,readFileSync(fd,'utf8').trim())}finally{closeSync(fd)}
}
