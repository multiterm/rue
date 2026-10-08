#!/usr/bin/env node
// Offline preparation only. No upload, secret rotation, or deployment.
import {readFileSync,writeFileSync,mkdirSync,rmSync,realpathSync,statSync} from 'node:fs'
import {resolve,relative,isAbsolute,join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {decodePushRuntime,pushNames} from './api-secret-runtime.mjs'

export async function preparePushRuntime(runtime,source,output,codec){
 if(!['dev','preview','prod'].includes(runtime)||!isAbsolute(source)||!isAbsolute(output))throw Error('Use a runtime and absolute private input/output paths')
 const root=realpathSync(fileURLToPath(new URL('../../',import.meta.url)))
 const outside=path=>{const rel=relative(root,path);return rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(rel)}
 const input=realpathSync(source),destination=join(realpathSync(resolve(output,'..')),output.split('/').at(-1))
 if(!outside(input)||!outside(destination))throw Error('Input and output must stay outside the source tree')
 const stat=statSync(input)
 if(!stat.isFile()||(stat.mode&0o077)||stat.size>65536)throw Error('Source must be a private regular configuration file')
 codec??=await import('@multiterm/envx')
 const values=codec.toRecord(codec.parseEnv(readFileSync(input,'utf8')))
 if(Object.keys(values).length!==3||Object.keys(values).some(name=>!pushNames.includes(name)))throw Error('Source must contain only the three existing push values')
 const wrapping=codec.generateKeyPair()
 const encrypted=`ENVX_PUBLIC_KEY_${runtime.toUpperCase()}=${wrapping.publicKey}\n`+pushNames.map(name=>`${name}="${codec.encryptValueAsymmetric(values[name],wrapping.publicKey)}"`).join('\n')+'\n'
 // Verify the unchanged original pair and contact before writing anything.
 await decodePushRuntime(encrypted,wrapping.privateKey,values,codec)
 mkdirSync(destination,{mode:0o700}) // Exclusive: never overwrite an existing migration bundle.
 try{
  mkdirSync(join(destination,'payload'),{mode:0o700})
  writeFileSync(join(destination,'payload','.env'),encrypted,{flag:'wx',mode:0o600})
  writeFileSync(join(destination,'bootstrap.env'),`ENVX_PRIVATE_KEY_${runtime.toUpperCase()}=${wrapping.privateKey}\n`,{flag:'wx',mode:0o600})
 }catch(error){rmSync(destination,{recursive:true,force:true});throw error}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const [runtime,source,output,...extra]=process.argv.slice(2)
 if(!runtime||!source||!output||extra.length){console.error('Usage: prepare-push-runtime.mjs dev|preview|prod /private/existing-push.env /private/new-bundle');process.exitCode=1}
 else preparePushRuntime(runtime,source,output).then(()=>console.log('Prepared verified ciphertext in payload/.env and a separate private bootstrap.env. Nothing was uploaded or rotated.')).catch(()=>{console.error('Push migration preparation failed; values withheld and existing keys unchanged');process.exitCode=1})
}
