import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {assertDevelopmentSyntax,runtimeSource} from '../scripts/deployment/check-development-syntax.mjs'
import {syncDevelopment} from '../scripts/deployment/sync-development.mjs'

test('syntax preflight catches the CLI outage before any remote sync or build',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rue-syntax-')),file='packages/apps/core/src/cli/control.ts'
 try{
  await mkdir(join(root,'packages/apps/core/src/cli'),{recursive:true})
  await writeFile(join(root,file),"builder.command({handler:()=> 'private-literal'\n")
  const calls=[]
  await assert.rejects(syncDevelopment(async()=>calls.push('sync'),root,undefined,async()=>calls.push('build'),()=>assertDevelopmentSyntax(root,[file])),error=>error.message.includes(file)&&!error.message.includes('private-literal'))
  assert.deepEqual(calls,[])
  await writeFile(join(root,file),"const builder={command:(_:unknown)=>{}}; builder.command({handler:()=> 'ok'})\n")
  await assertDevelopmentSyntax(root,[file])
  await writeFile(join(root,file),'throw new Error("must never execute")\n')
  await assertDevelopmentSyntax(root,[file])
 }finally{await rm(root,{recursive:true,force:true})}
})
test('preflight excludes nested checkouts, dependencies, outputs and secrets',()=>{
 for(const path of ['.worktrees/other/packages/a.ts','packages/a/.worktrees/b/a.ts','packages/a/node_modules/b/a.js','packages/a/dist/a.js','packages/.env/a.ts','packages/../secret.ts'])assert.equal(runtimeSource(path),false,path)
 for(const path of ['packages/a/src/a.tsx','extensions/rue/index.ts','scripts/deployment/check.mjs'])assert.equal(runtimeSource(path),true,path)
})
