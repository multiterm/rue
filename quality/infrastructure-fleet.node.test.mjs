import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fleetConnection,trustedHost,inventoryFleet} from '../scripts/deployment/inventory-infrastructure-fleet.mjs'
const source='ansible_host: 100.114.99.85\nansible_port: 2220\nansible_user: ansible\n'
test('fleet inventory preserves explicit endpoints and does not copy secrets or guess inherited values',()=>{
 assert.deepEqual(fleetConnection(source),{ready:true,host:'100.114.99.85',port:2220,user:'ansible',blockers:[]})
 for(const text of [source+'ansible_port: 22',source.replace('2220','{{ sshport }}'),source.replace('ansible_port: 2220\n',''),source.replace('ansible','root;bad')])assert.equal(fleetConnection(text).ready,false)
 assert.equal(JSON.stringify(fleetConnection(source+'ansible_password: secret-value')).includes('secret-value'),false)
})
test('trust checks are local only and refuse revoked keys or lookup failure',()=>{
 const record=fleetConnection(source),calls=[]
 const lookup=(...args)=>{calls.push(args);return {status:0,stdout:'# found\n[100.114.99.85]:2220 ssh-ed25519 public-key\n'}}
 assert.equal(trustedHost(record,'/private/known_hosts',lookup),true)
 assert.deepEqual(calls[0][1],['-F','[100.114.99.85]:2220','-f','/private/known_hosts'])
 assert.equal(trustedHost(record,'file',()=>({status:0,stdout:'@revoked host ssh-ed25519 key'})),false)
 assert.equal(trustedHost(record,'file',()=>({status:1,stdout:''})),false)
})
test('flat and directory inventories work; nested checkouts and symlinks are excluded',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rue-fleet-'))
 try{
  const hosts=join(root,'inventory/host_vars');await mkdir(join(hosts,'abby'),{recursive:true});await mkdir(join(hosts,'.worktrees'))
  await writeFile(join(hosts,'abby/00-connection.yml'),source);await writeFile(join(hosts,'mason.yml'),source.replace('ansible_user: ansible','ansible_user: calvin'))
  await symlink(join(hosts,'mason.yml'),join(hosts,'leak.yml'))
  const result=await inventoryFleet(root,join(root,'missing-known-hosts'))
  assert.equal(result.counts.total,2);assert.equal(result.counts.trusted,0);assert.equal(result.grantsInstalled,false)
 }finally{await rm(root,{recursive:true,force:true})}
})
