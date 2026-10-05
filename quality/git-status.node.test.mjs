import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {readGitStatus} from '../extensions/rue/git-status.ts'
import {agentStatusSchema} from '../packages/apps/core/src/storage/agent-status.ts'
import {agentStatus} from '../extensions/rue/status.ts'
test('Git metadata is local, bounded, URL-free and absent outside repositories',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rue-git-status-'))
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 try{
  assert.equal(await readGitStatus(dir),null)
  git('init','-b','main');git('remote','add','origin','https://private:credential@example.invalid/repo.git')
  assert.equal((await readGitStatus(dir)).branch,'main')
  writeFileSync(join(dir,'file'),'fixture');git('add','file');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture')
  git('branch','feature/test');mkdirSync(join(dir,'nested'))
  let value=await readGitStatus(join(dir,'nested'))
  assert.equal(value.branch,'main');assert.equal(value.remote,'origin');assert.deepEqual(value.localBranches,['feature/test','main']);assert.ok(!JSON.stringify(value).includes('credential'));assert.equal(value.truncated,false)
  assert.ok(agentStatusSchema.safeParse(agentStatus({cwd:dir,branch:value.branch,git:value,idle:true,thinking:'off',entries:[]})).success)
  git('checkout','--detach');assert.equal((await readGitStatus(dir)).branch,null)
  git('checkout','main');for(let i=0;i<52;i++)git('branch',`fixture-${i}`)
  value=await readGitStatus(dir);assert.equal(value.localBranches.length,50);assert.equal(value.truncated,true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
