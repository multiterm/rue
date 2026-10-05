#!/usr/bin/env node
import {createRequire} from 'node:module'
import {openSync,writeSync,fsyncSync,closeSync,realpathSync} from 'node:fs'
import {resolve,dirname,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(new URL('../../packages/apps/core/package.json',import.meta.url))
const webpush=require('web-push')
const [subject,output,...extra]=process.argv.slice(2)
if(!subject||!output||extra.length||!isAbsolute(output)||/[\s\x00-\x1f\x7f]/.test(subject))throw Error('Usage: node scripts/deployment/generate-push-config.mjs mailto:operator@example.com /private/path/push.env')
const contact=new URL(subject)
if(!['mailto:','https:'].includes(contact.protocol)||contact.username||contact.password)throw Error('Use an HTTPS or mailto operator contact without credentials')
const root=realpathSync(fileURLToPath(new URL('../../',import.meta.url))),target=resolve(realpathSync(dirname(output)),output.split('/').at(-1)),rel=relative(root,target)
if(rel===''||(!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(rel)))throw Error('Store VAPID credentials outside the repository and synced source tree')
const keys=webpush.generateVAPIDKeys();webpush.setVapidDetails(subject,keys.publicKey,keys.privateKey)
const fd=openSync(target,'wx',0o600)
try{writeSync(fd,`RUE_PUSH_SUBJECT=${subject}\nRUE_PUSH_PUBLIC_KEY=${keys.publicKey}\nRUE_PUSH_PRIVATE_KEY=${keys.privateKey}\n`);fsyncSync(fd)}finally{closeSync(fd)}
console.log('Created private Web Push configuration. Load it into the API environment and back it up securely. No key was printed; existing files are never overwritten.')
