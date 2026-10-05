import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {validHostDirectory,validFilesystemPolicy,validWorkspaceRoots,requiresWorkspaceRoots} from '../packages/libs/sdk/src/filesystem.ts'
import {approvedShares,verifyMounts,loadWorkspaceRoots} from '../scripts/deployment/mason-worker.mjs'
const valid=['/Users/calvin/projects','/Users/calvin/.ssh','/home/operator/project','/srv/repositories','/data','/Volumes/OTHER/project','/Volumes/MOTHERSHIP','/Volumes/MOTHERSHIP-other','/data/a space','/data/日本語','/data/.local/share']
const invalid=['/','relative','/Users','/Users/calvin','/home/operator','/root','/Volumes','/etc','/usr/local','/control','/state','/workspace','/app','/var','/var/lib','/var/lib/docker/volumes','/run','/tmp/work','/data/..','/data/../outside','/data/.','/data//project','/data/','/data/line\nnext','/Users/calvin/.colima','/Users/calvin/.colima/rue','/Users/calvin/.docker/run','/Users/calvin/.local','/Users/calvin/.local/state','/Users/calvin/.local/state/rue/credentials','/Users/calvin/Library','/Users/calvin/Library/Caches','/Users/calvin/Library/Caches/colima','/Volumes/MOTHERSHIP/.rue-colima-cache','/Volumes/MOTHERSHIP/.rue-colima-cache/assets','/Volumes/MOTHERSHIP/.RUE-COLIMA-CACHE','/Users/calvin/.COLIMA','/Users/calvin/.Local/State/Rue','/data/'+'é'.repeat(510)]
for(const path of valid)test('allows explicit workspace location '+path,()=>assert.equal(validHostDirectory(path),true))
for(const path of invalid)test('refuses unsafe/reserved location '+JSON.stringify(path.slice(0,90)),()=>assert.equal(validHostDirectory(path),false))
test('keeps additive grant bounds and read-only-parent semantics',()=>{
 const p=directories=>({version:1,directories})
 assert.equal(validFilesystemPolicy(p([{path:'/Users/calvin/projects',access:'read'},{path:'/Users/calvin/projects/example',access:'write'}])),true)
 assert.equal(validFilesystemPolicy(p([{path:'/Users/calvin/projects',access:'write'},{path:'/Users/calvin/projects/example',access:'read'}])),false)
 assert.equal(validFilesystemPolicy(p(Array.from({length:9},(_,i)=>({path:'/data/'+i,access:'read'})))),false)
 assert.equal(validFilesystemPolicy(p([{path:'/data',access:'read'},{path:'/data',access:'write'}])),false)
 assert.equal(validFilesystemPolicy(p([{path:'/data/Project',access:'write'},{path:'/data/project/private',access:'read'}])),false)
 assert.equal(validFilesystemPolicy(p([{path:'/data/Project',access:'write'},{path:'/data/project',access:'read'}])),false)
 assert.equal(requiresWorkspaceRoots(p([{path:'/Users/calvin/.ssh',access:'read'}])),true)
 assert.equal(requiresWorkspaceRoots(p([{path:'/Volumes/MOTHERSHIP/project',access:'read'}])),false)
})
test('operator roots are separately validated and cannot overlap',()=>{
 assert.equal(validWorkspaceRoots(['/Users/calvin/projects','/Users/calvin/.ssh']),true)
 assert.equal(validWorkspaceRoots(['/Users/calvin/projects','/Users/calvin/projects/child']),false)
 assert.equal(validWorkspaceRoots(['/data','/data']),false)
 assert.equal(validWorkspaceRoots(['/control']),false)
 assert.throws(()=>approvedShares(['/Volumes/MOTHERSHIP/project']))
})
test('Mason accepts only explicitly listed shares, not extra or nested mounts',()=>{
 const extra=['/Users/calvin/.ssh']
 verifyMounts([{target:'/Volumes/MOTHERSHIP'},{target:extra[0]}],extra)
 assert.throws(()=>verifyMounts([{target:'/Volumes/MOTHERSHIP'},{target:extra[0]}]))
 assert.throws(()=>verifyMounts([{target:'/Volumes/MOTHERSHIP'},{target:extra[0],children:[{target:extra[0]+'/nested'}]}],extra))
 assert.throws(()=>verifyMounts([{target:'/Volumes/MOTHERSHIP'},{target:'/Volumes/MOTHERSHIP'}],extra))
})
test('Mason roots configuration requires a private operator file',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'rue-workspace-roots-')),file=join(directory,'roots.json')
 try{
  assert.equal(loadWorkspaceRoots(file),undefined)
  assert.throws(()=>loadWorkspaceRoots(file,true))
  await writeFile(file,JSON.stringify(['/Users/calvin/.ssh']),{mode:0o600})
  assert.deepEqual(loadWorkspaceRoots(file,true),['/Users/calvin/.ssh'])
  await chmod(file,0o644);assert.throws(()=>loadWorkspaceRoots(file,true))
  await chmod(file,0o600);await writeFile(file,JSON.stringify(['/Users/calvin/.colima']))
  assert.throws(()=>loadWorkspaceRoots(file,true))
 }finally{await rm(directory,{recursive:true,force:true})}
})
const compiler=JSON.parse(process.env.RUE_NATIVE_CC_JSON??'["cc"]')
const available=process.platform==='linux'&&spawnSync(compiler[0],[...compiler.slice(1),'--version']).status===0
test('independent native path validator agrees with SDK policy',{skip:!available},async()=>{
 const directory=await mkdtemp(join(process.env.RUE_NATIVE_TEST_DIR??tmpdir(),'rue-native-policy-'))
 try{
  const source=fileURLToPath(new URL('../packages/apps/agent-runtime/src/sandbox/mount-check.c',import.meta.url))
  const wrapper=join(directory,'test.c'),binary=join(directory,'test')
  await writeFile(wrapper,`#define main production_main\n#include ${JSON.stringify(source)}\n#undef main\nint main(int argc,char **argv){if(argc==2){allowed(argv[1]);return 0;}if(argc==4&&!strcmp(argv[1],"anchor")){struct stat st={0};st.st_dev=makedev(0,42);anchor(argv[2],argv[3],&st);return 0;}return 1;}\n`)
  const build=spawnSync(compiler[0],[...compiler.slice(1),'-std=c11','-Wall','-Wextra','-Werror',wrapper,'-o',binary],{encoding:'utf8'})
  assert.equal(build.status,0,build.stderr)
  for(const path of [...valid,...invalid])assert.equal(spawnSync(binary,[path]).status,validHostDirectory(path)?0:78,JSON.stringify(path))
  const metadata=join(directory,'mountinfo'),target='/Users/calvin/.ssh'
  const good=`71 22 0:42 / ${target} rw shared:1 - virtiofs share1 rw\n`
  for(const [content,path,code] of [
   [good,target,0],
   [good.replace('0:42','0:43'),target,78],
   [good.replace(' / ',' /aliased-subdirectory '),target,78],
   [good.replace('virtiofs','ext4'),target,78],
   [good,'/Users/calvin/missing',78],
   [good+good,target,78],
   [good.replace(target,'/Users/calvin/my\\040projects'),'/Users/calvin/my projects',0],
   [good.replace(target,target+'\\000spoof'),target,78],
  ]){await writeFile(metadata,content);assert.equal(spawnSync(binary,['anchor',metadata,path]).status,code,'native root anchor')}

 }finally{await rm(directory,{recursive:true,force:true})}
})
