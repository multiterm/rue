import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {expect,test} from 'vitest'
import {persistentSession} from '../src/session.js'
test('real Pi SDK preserves identity and the first user message across a restart without a model response',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rue-agent-session-')),id=randomUUID()
 try{
  const first=persistentSession('/workspace',dir,id)
  first.appendMessage({role:'user',content:'Do not replay this automatically',timestamp:123})
  const resumed=persistentSession('/workspace',dir,id)
  expect(resumed.getSessionId()).toBe(id);expect(resumed.getSessionFile()).toBe(first.getSessionFile())
  expect(resumed.buildSessionContext().messages).toMatchObject([{role:'user',content:'Do not replay this automatically'}])
  expect(resumed.getEntries()).toHaveLength(1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('foreign, corrupt and symlinked history is rejected without rewriting it',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rue-agent-session-')),id=randomUUID(),file=join(dir,id+'.jsonl')
 try{
  const original=JSON.stringify({type:'session',version:1,id:randomUUID(),cwd:'/workspace'})+'\n'
  writeFileSync(file,original)
  expect(()=>persistentSession('/workspace',dir,id)).toThrow();expect(readFileSync(file,'utf8')).toBe(original)
  writeFileSync(file,'corrupt');expect(()=>persistentSession('/workspace',dir,id)).toThrow();expect(readFileSync(file,'utf8')).toBe('corrupt')
  rmSync(file);writeFileSync(join(dir,'other'),'private');symlinkSync(join(dir,'other'),file)
  expect(()=>persistentSession('/workspace',dir,id)).toThrow();expect(readFileSync(join(dir,'other'),'utf8')).toBe('private')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
