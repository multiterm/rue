import {test, expect} from 'vitest'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {snapshot, assertTarget} from '../scripts/deployment/watch-development-sync.mjs'
const target={environment:'development',runtimeMode:'development',projectId:'project',sandboxId:'sandbox',workspaceId:'workspace'}
test('watcher rejects immutable or changed targets',()=>{
  expect(()=>assertTarget(target,target)).not.toThrow()
  for(const changed of [{runtimeMode:'immutable'},{environment:'production'},{sandboxId:'other'},{workspaceId:'other'},{projectId:'other'}])expect(()=>assertTarget(target,{...target,...changed})).toThrow()
})
test('source snapshots detect edits and deletion without rebuilding libraries for CSS',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rue-watch-test-'))
  try{
    await mkdir(join(root,'packages/libs/sdk'),{recursive:true})
    const files=['app.css','packages/libs/sdk/index.ts','.worktrees/nested.ts','.env']
    await mkdir(join(root,'.worktrees'))
    await writeFile(join(root,'app.css'),'one');await writeFile(join(root,files[1]),'old')
    const first=await snapshot(root,files)
    await writeFile(join(root,'app.css'),'two')
    const css=await snapshot(root,files);expect(css.source).not.toBe(first.source);expect(css.libraries).toBe(first.libraries)
    await writeFile(join(root,'.worktrees/nested.ts'),'ignored');await writeFile(join(root,'.env'),'ignored')
    expect(await snapshot(root,files)).toEqual(css)
    await writeFile(join(root,files[1]),'new');const sdk=await snapshot(root,files);expect(sdk.libraries).not.toBe(css.libraries)
    await rm(join(root,files[1]));expect((await snapshot(root,files)).libraries).not.toBe(sdk.libraries)
  }finally{await rm(root,{recursive:true,force:true})}
})
