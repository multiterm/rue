// Local -> mutable development only. Never promotes preview or production.
import {spawn, execFileSync} from 'node:child_process'
import {readFile, lstat, mkdir, writeFile, rm} from 'node:fs/promises'
import {resolve, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'
import {buildDevelopmentLibraries} from './build-development-libraries.mjs'

export function assertTarget(initial, state) {
  for (const value of [initial,state]) if (value.environment!=='development'||value.runtimeMode!=='development'||!value.sandboxId||!value.workspaceId||!value.projectId) throw new Error('A bound mutable development target is required')
  for (const key of ['projectId','sandboxId','workspaceId']) if(initial[key]!==state[key]) throw new Error('Development target changed; restart the watcher intentionally')
}
export async function snapshot(root, files) {
  files ??= execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
  const source=createHash('sha256'), libraries=createHash('sha256')
  for(const name of [...new Set(files)].sort()) {
    if(name.split('/').some(part=>['.git','.worktrees','.sandblocks','.runway','node_modules','dist','coverage','references'].includes(part)||part.startsWith('.env'))) continue
    try {
      if(!(await lstat(join(root,name))).isFile()) continue
      const data=await readFile(join(root,name)); source.update(name+'\0').update(data)
      if(name.startsWith('packages/libs/')||['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json'].includes(name)) libraries.update(name+'\0').update(data)
    } catch(error) {if(error.code!=='ENOENT')throw error}
  }
  return {source:source.digest('hex'),libraries:libraries.digest('hex')}
}
export async function watch(root) {
  const statePath=join(root,'.sandblocks/sandbox-development.json'),lock=join(root,'.sandblocks/local-sync.lock'),pidFile=join(root,'.sandblocks/development-sync.pid')
  const initial=JSON.parse(await readFile(statePath,'utf8'));assertTarget(initial,initial)
  const checks=process.env.RUE_SYNC_CHECKS??'none'
  if(!['none','smoke','full'].includes(checks))throw new Error('Invalid RUE_SYNC_CHECKS')
  await mkdir(lock,{mode:0o700})
  let child,stopped=false,previous,built
  const stop=()=>{stopped=true;child?.kill('SIGTERM')}
  process.once('SIGINT',stop);process.once('SIGTERM',stop)
  const run=args=>new Promise((resolve,reject)=>{
    child=spawn(join(root,'node_modules/.bin/sandblocks'),args,{cwd:root,stdio:'inherit'})
    child.once('error',()=>reject(new Error('Could not start Sandblocks')))
    child.once('exit',code=>{child=undefined;code===0?resolve():reject(new Error(`Sandblocks exited ${code}`))})
  })
  try {
    await writeFile(pidFile,String(process.pid)+'\n',{mode:0o600})
    while(!stopped) {
      assertTarget(initial,JSON.parse(await readFile(statePath,'utf8')))
      const next=await snapshot(root)
      if(next.source!==previous) {
        // Capture BEFORE upload/build so edits made while busy are not lost.
        previous=next.source
        try {
          await run(['sandbox','sync',root,'--environment','development','--checks','none'])
          if(!stopped&&next.libraries!==built){await buildDevelopmentLibraries(root);built=next.libraries}
          if(!stopped&&checks!=='none')await run(['sandbox','check',root,'--environment','development','--profile',checks])
          if(!stopped)console.log('watch: development synchronized; watching for local changes')
        }catch{if(!stopped)console.error('Sync/build/check failed; inspect the protected operation logs. Retrying after the next source edit.')}
      }
      if(!stopped)await sleep(1500)
    }
  } finally {
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)
    await rm(lock,{recursive:true,force:true});await rm(pidFile,{force:true})
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await watch(resolve(import.meta.dirname,'../..'))
