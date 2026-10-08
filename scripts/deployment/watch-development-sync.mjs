// Local -> mutable development only. Never promotes preview or production.
import {spawn, execFileSync} from 'node:child_process'
import {readFile, lstat, mkdir, writeFile, rm} from 'node:fs/promises'
import {resolve, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'
import {buildDevelopmentLibraries} from './build-development-libraries.mjs'
import {assertDevelopmentSyntax} from './check-development-syntax.mjs'

export function assertTarget(initial, state) {
  for (const value of [initial,state]) if (value.environment!=='development'||value.runtimeMode!=='development'||!value.sandboxId||!value.workspaceId||!value.projectId) throw new Error('A bound mutable development target is required')
  for (const key of ['projectId','sandboxId','workspaceId']) if(initial[key]!==state[key]) throw new Error('Development target changed; restart the watcher intentionally')
}
export async function snapshot(root, files) {
  files ??= execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
  const source=createHash('sha256'), libraries=createHash('sha256'), dependencies=createHash('sha256')
  for(const name of [...new Set(files)].sort()) {
    if(name.split('/').some(part=>['.git','.worktrees','.sandblocks','.runway','node_modules','dist','coverage','references'].includes(part)||part.startsWith('.env')||part.startsWith('.locker'))) continue
    try {
      if(!(await lstat(join(root,name))).isFile()) continue
      const data=await readFile(join(root,name)); source.update(name+'\0').update(data)
      if(name==='package.json'||name.endsWith('/package.json')||['pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc'].includes(name))dependencies.update(name+'\0').update(data)
      if(name.startsWith('packages/libs/')||['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json'].includes(name)) libraries.update(name+'\0').update(data)
    } catch(error) {if(error.code!=='ENOENT')throw error}
  }
  return {source:source.digest('hex'),libraries:libraries.digest('hex'),dependencies:dependencies.digest('hex')}
}
export async function watch(root) {
  const statePath=join(root,'.sandblocks/sandbox-development.json'),lock=join(root,'.sandblocks/local-sync.lock'),pidFile=join(root,'.sandblocks/development-sync.pid')
  const initial=JSON.parse(await readFile(statePath,'utf8'));assertTarget(initial,initial)
  const checks=process.env.RUE_SYNC_CHECKS??'none'
  if(!['none','smoke','full'].includes(checks))throw new Error('Invalid RUE_SYNC_CHECKS')
  await mkdir(lock,{mode:0o700})
  let child,stopped=false,previous,built,installed,failures=0,retryAt=0
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
      if(next.source!==previous||(failures>0&&Date.now()>=retryAt)) {
        // Capture BEFORE upload/build so edits made while busy are not lost.
        previous=next.source
        try {
          await assertDevelopmentSyntax(root)
          await run(['sandbox','sync',root,'--environment','development','--checks','none'])
          if(!stopped&&(next.libraries!==built||next.dependencies!==installed)){await buildDevelopmentLibraries(root,undefined,{install:next.dependencies!==installed});built=next.libraries;installed=next.dependencies}
          if(!stopped&&checks!=='none')await run(['sandbox','check',root,'--environment','development','--profile',checks])
          failures=0;retryAt=0
          if(!stopped)console.log('watch: development synchronized; watching for local changes')
        }catch(error){if(!stopped){if(error.message?.startsWith('Development sync blocked by syntax errors:'))console.error(error.message);failures++;const delay=Math.min(60000,1000*2**Math.min(failures,6));retryAt=Date.now()+delay;console.error(`Sync/build/check failed; inspect the protected operation logs. Retrying in ${delay/1000}s or after the next source edit.`)}}
      }
      if(!stopped)await sleep(1500)
    }
  } finally {
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)
    await rm(lock,{recursive:true,force:true});await rm(pidFile,{force:true})
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await watch(resolve(import.meta.dirname,'../..'))
