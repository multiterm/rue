import {describe,it,expect} from 'vitest'
import {validFilesystemPolicy,sandboxArguments,workspaceRoot as root} from '../src/sandbox/policy.js'
const policy=(directories:unknown[])=>({version:1,directories})
describe('filesystem sandbox policy',()=>{
 it('denies all host content by default and permits explicit whole-volume write',()=>{
  expect(validFilesystemPolicy(policy([]))).toBe(true)
  expect(sandboxArguments(policy([{path:root,access:'write'}]),'/app/runner.js')).toEqual(['--write',root,'--','/usr/local/bin/node','/app/runner.js'])
 })
 it('supports read-only parent with writable project but rejects ineffective read-only exclusions',()=>{
  expect(validFilesystemPolicy(policy([{path:root,access:'read'},{path:root+'/project',access:'write'}]))).toBe(true)
  expect(validFilesystemPolicy(policy([{path:root,access:'write'},{path:root+'/private',access:'read'}]))).toBe(false)
 })
 it.each(['/','/etc','/Users/calvin/.colima','/Volumes/MOTHERSHIP/../other',root+'/./project',root+'//project',root+'/',root+'/a\nother',root+'/a\0other',root+'/.rue-colima-cache',root+'/.rue-colima-cache/assets'])('rejects nonliteral/out-of-boundary path %j',path=>{
  expect(validFilesystemPolicy(policy([{path,access:'write'}]))).toBe(false)
 })
 it('permits explicit directories outside the legacy share without exposing runtime control paths',()=>{
  for(const path of ['/Users/calvin/.ssh','/home/user/projects','/Volumes/MOTHERSHIP-other'])expect(validFilesystemPolicy(policy([{path,access:'read'}]))).toBe(true)
  for(const path of ['/control','/state','/Users/calvin','/Users/calvin/.docker','/var/lib/docker'])expect(validFilesystemPolicy(policy([{path,access:'read'}]))).toBe(false)
 })
 it('bounds grants and rejects duplicate paths, unknown fields, invalid modes and alternate commands',()=>{
  expect(validFilesystemPolicy(policy(Array.from({length:9},(_,i)=>({path:root+'/'+i,access:'read'}))))).toBe(false)
  expect(validFilesystemPolicy(policy([{path:root,access:'read'},{path:root,access:'write'}]))).toBe(false)
  expect(validFilesystemPolicy(policy([{path:root,access:['write']}]))).toBe(false)
  expect(validFilesystemPolicy({...policy([]),bypass:true})).toBe(false)
  expect(validFilesystemPolicy(policy([{path:root,access:'read',recursive:false}]))).toBe(false)
  expect(()=>sandboxArguments(policy([]),'/tmp/runner.js')).toThrow('agent_filesystem_policy_invalid')
 })
})
