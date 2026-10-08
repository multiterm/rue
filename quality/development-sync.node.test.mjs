import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {snapshot,assertTarget} from '../scripts/deployment/watch-development-sync.mjs'
import {developmentBuildPayload} from '../scripts/deployment/build-development-libraries.mjs'
const state={environment:'development',runtimeMode:'development',workerId:'worker',workspaceId:'workspace',sandboxId:'sandbox',sourceRevision:'revision',projectId:'project'}
test('initial/dependency builds install frozen dependencies; source-only library builds do not',()=>{
 const initial=developmentBuildPayload(state),incremental=developmentBuildPayload(state,{install:false})
 assert.deepEqual(initial.payload.steps.map(s=>s.id),['workspace-setup','build-libs'])
 assert.ok(initial.payload.steps[0].command.includes('--frozen-lockfile'))
 assert.deepEqual(incremental.payload.steps.map(s=>s.id),['build-libs'])
 assert.throws(()=>developmentBuildPayload({...state,environment:'production'}))
 assert.throws(()=>assertTarget(state,{...state,workspaceId:'other'}))
})
test('snapshot separately tracks dependencies and library source, excluding secrets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rue-sync-hashes-'))
 try{
  await mkdir(join(root,'packages/libs/test'),{recursive:true});await mkdir(join(root,'packages/apps/test'),{recursive:true})
  const files=['packages/libs/test/index.ts','packages/apps/test/package.json','.env.secret']
  for(const file of files)await writeFile(join(root,file),file.endsWith('.json')?'{}':'initial')
  const before=await snapshot(root,files)
  await writeFile(join(root,files[0]),'changed library')
  const source=await snapshot(root,files);assert.notEqual(source.libraries,before.libraries);assert.equal(source.dependencies,before.dependencies)
  await writeFile(join(root,files[1]),'{"dependencies":{"fixture":"1"}}')
  const dependencies=await snapshot(root,files);assert.notEqual(dependencies.dependencies,source.dependencies)
  await writeFile(join(root,files[2]),'private value changed')
  assert.deepEqual(await snapshot(root,files),dependencies)
 }finally{await rm(root,{recursive:true,force:true})}
})
