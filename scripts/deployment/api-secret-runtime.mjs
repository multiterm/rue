#!/usr/bin/env node
// API-only bootstrap. Never invoke from a frontend build or share its output directory.
import {createRequire} from 'node:module'
import {createECDH} from 'node:crypto'
import {mkdtempSync,readFileSync,rmSync,lstatSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {spawn,spawnSync} from 'node:child_process'

export const pushNames=['RUE_PUSH_PRIVATE_KEY','RUE_PUSH_PUBLIC_KEY','RUE_PUSH_SUBJECT']
export function runtimeSelection(env){
 if(!env.RUE_SECRET_SOURCE)return null
 if(env.RUE_SECRET_SOURCE!=='dotlocker')throw Error('Unsupported API secret source')
 const runtime=env.RUE_SECRET_RUNTIME
 if(!['dev','preview','prod'].includes(runtime))throw Error('Select an explicit API secret runtime: dev, preview or prod')
 const keyName=`ENVX_PRIVATE_KEY_${runtime.toUpperCase()}`
 if(!env.DOTLOCKER_TOKEN||!env[keyName])throw Error('API-scoped Dotlocker token and Envx private key are required')
 return {runtime,keyName}
}
export function applicationEnvironment(env){
 return Object.fromEntries(Object.entries(env).filter(([key])=>!key.startsWith('DOTLOCKER_')&&!key.startsWith('ENVX_PRIVATE_KEY')&&!key.startsWith('DOTENV_PRIVATE_KEY')&&key!=='SANDBLOCKS_APP_ENVIRONMENTS'))
}
export async function decodePushRuntime(text,key,existing={},codec){
 try{
  codec??=await import('@multiterm/envx')
  const lines=codec.parseEnv(text),record=codec.toRecord(lines)
  if(lines.filter(line=>line.type==='kv').length!==Object.keys(record).length||lines.some(line=>line.type==='raw'&&line.raw.trim()&&!line.raw.trimStart().startsWith('#')))throw Error()
  // Reject unknown variables (including loader options, public mirrors and key files).
  const allowed=new Set([...pushNames,'ENVX_PUBLIC_KEY','ENVX_PUBLIC_KEY_DEV','ENVX_PUBLIC_KEY_PREVIEW','ENVX_PUBLIC_KEY_PROD'])
  if(Object.keys(record).some(name=>!allowed.has(name)))throw Error()
  const result={}
  for(const name of pushNames){
   if(!codec.isEncrypted(record[name]??''))throw Error()
   const value=codec.decryptValueAsymmetric(record[name],key)
   if(!value||/[\x00-\x20\x7f]/.test(value)||(existing[name]!==undefined&&existing[name]!==value))throw Error()
   result[name]=value
  }
  const privateKey=Buffer.from(result.RUE_PUSH_PRIVATE_KEY,'base64url'),publicKey=Buffer.from(result.RUE_PUSH_PUBLIC_KEY,'base64url')
  if(privateKey.length!==32||publicKey.length!==65||privateKey.toString('base64url')!==result.RUE_PUSH_PRIVATE_KEY||publicKey.toString('base64url')!==result.RUE_PUSH_PUBLIC_KEY)throw Error()
  const pair=createECDH('prime256v1');pair.setPrivateKey(privateKey)
  if(!pair.getPublicKey().equals(publicKey))throw Error()
  const subject=new URL(result.RUE_PUSH_SUBJECT)
  if(!['mailto:','https:'].includes(subject.protocol)||!subject.pathname||subject.username||subject.password)throw Error()
  return result
 }catch{throw Error('Encrypted API push configuration is invalid, incomplete, or conflicts with existing keys; values withheld')}
}

export async function loadApiEnvironment(env){
 const selected=runtimeSelection(env)
 if(!selected)return applicationEnvironment(env)
 const directory=mkdtempSync(join(tmpdir(),'rue-api-ciphertext-'))
 try{
  const require=createRequire(new URL('../../package.json',import.meta.url))
  const cli=fileURLToPath(new URL('../cli.js',pathToFileURL(require.resolve('@dotlocker/dotlocker/client'))))
  // The pull process receives the read token, but never the decryption key or API secrets.
  const pullEnv=Object.fromEntries(['PATH','HOME','TMPDIR','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS'].filter(name=>env[name]).map(name=>[name,env[name]]))
  pullEnv.DOTLOCKER_TOKEN=env.DOTLOCKER_TOKEN
  const pull=spawnSync(process.execPath,[cli,'pull','--config',fileURLToPath(new URL('../../config/dotlocker.config.json',import.meta.url)),'--runtime',selected.runtime,'--out',directory],{env:pullEnv,stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:1024*1024})
  if(pull.error||pull.status!==0)throw Error('API encrypted-runtime retrieval failed; output withheld')
  const file=join(directory,'.env'),stat=lstatSync(file)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('Invalid encrypted API runtime file')
  const values=await decodePushRuntime(readFileSync(file,'utf8'),env[selected.keyName],env)
  return {...applicationEnvironment(env),...values}
 }finally{rmSync(directory,{recursive:true,force:true})}
}

async function main(){
 const [separator,command,...args]=process.argv.slice(2)
 if(separator!=='--'||!command)throw Error('Usage: api-secret-runtime.mjs -- command [arguments]')
 const env=await loadApiEnvironment(process.env)
 const child=spawn(command,args,{env,stdio:'inherit'})
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal))
 child.on('error',()=>{console.error('API process could not start');process.exitCode=1})
 child.on('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGTERM'?143:130)})
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(()=>{console.error('API secret bootstrap failed; configuration and credentials were not logged');process.exitCode=1})
