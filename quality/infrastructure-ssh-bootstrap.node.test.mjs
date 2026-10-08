import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,createHash} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {connection,publicIdentity,expiry,sshArgs,remoteProgram} from '../scripts/deployment/bootstrap-infrastructure-ssh.mjs'

const id='49799108-4633-4772-9e5b-7d007ce14ffd'
const key=generateKeyPairSync('ed25519').publicKey.export({format:'jwk'})
const wire=Buffer.concat([Buffer.from('0000000b7373682d6564323535313900000020','hex'),Buffer.from(key.x,'base64url')])
const blob=wire.toString('base64')
const bundle={requestId:id,requestedOwnerEmail:'r@honeycluster.io',publicKey:'ssh-ed25519 '+blob,fingerprint:'SHA256:'+createHash('sha256').update(wire).digest('base64').replace(/=+$/,'')}
const inventory='ansible_host: 100.114.99.85\nansible_port: 2220\nansible_user: ansible\nansible_ssh_private_key_file: ~/.ssh/ansible-honey\n'
const deadline=()=>new Date(Date.now()+3600000).toISOString().replace(/\.\d{3}Z$/,'Z')

test('uses inventory port and controller identity rather than assuming port 22',()=>{
 assert.deepEqual(connection(inventory,'/Users/calvin'),{host:'100.114.99.85',port:2220,user:'ansible',key:'/Users/calvin/.ssh/ansible-honey'})
})
test('rejects duplicate, templated and non-ansible connection fields',()=>{
 for(const text of [inventory+'ansible_port: 22',inventory.replace('100.114.99.85','{{ untrusted }}'),inventory.replace('ansible_user: ansible','ansible_user: root')])assert.throws(()=>connection(text))
})
test('validates public key encoding, fingerprint and request identity',()=>{
 assert.equal(publicIdentity(bundle).blob,blob)
 for(const invalid of [{...bundle,fingerprint:'SHA256:wrong'},{...bundle,publicKey:'-----BEGIN OPENSSH PRIVATE KEY-----'},{...bundle,requestId:'------------------------------------'},{...bundle,requestedOwnerEmail:'other@example.com'}])assert.throws(()=>publicIdentity(invalid))
})
test('requires bounded, canonical UTC expiry',()=>{
 assert.match(expiry(deadline()),/^\d{14}Z$/)
 assert.throws(()=>expiry('2000-01-01T00:00:00Z'))
 assert.throws(()=>expiry(new Date(Date.now()+48*3600000).toISOString().replace('.000Z','Z')))
 assert.throws(()=>expiry('2026-02-31T12:00:00Z',Date.parse('2026-03-02T13:00:00Z')))
})
test('SSH disables password fallback, forwarding and shared connections; never disables trust',()=>{
 const args=sshArgs(connection(inventory,'/Users/calvin'),'/Users/calvin/.ssh/known_hosts','true')
 for(const value of ['StrictHostKeyChecking=yes','ForwardAgent=no','ClearAllForwardings=yes','ControlPath=none','PasswordAuthentication=no','KbdInteractiveAuthentication=no','IdentitiesOnly=yes'])assert.ok(args.includes(value))
 assert.deepEqual(args.slice(-3),['--','100.114.99.85','true'])
 assert.ok(!args.includes('StrictHostKeyChecking=no'))
})
test('remote enrollment program is valid POSIX shell',()=>{
 const result=spawnSync('sh',['-n'],{input:remoteProgram,encoding:'utf8'})
 assert.equal(result.status,0,result.stderr)
})

// Local filesystem fixtures only. Identity and sudo are explicit test doubles;
// these checks do not authenticate to a host or establish live admin privileges.
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'rue-ssh-enroll-'))
 try{
  const home=join(root,'home'),sshdir=join(home,'.ssh')
  await mkdir(sshdir,{recursive:true,mode:0o700})
  const doubles=`id() { printf 'ansible\\n'; }\nsudo() { printf '0\\n'; }\ngetent() { printf 'ansible:x:1000:1000::${home}:/bin/sh\\n'; }\nhostname() { printf 'fixture\\n'; }\n`
  const auth=join(sshdir,'authorized_keys'),original='existing-operator-key\n'
  await writeFile(auth,original,{mode:0o600})
  const run=(mode,until=expiry(deadline()))=>spawnSync('sh',['-s','--',mode,id,blob,until],{input:doubles+remoteProgram,encoding:'utf8',env:process.env})
  await fn({run,auth,sshdir,original})
 }finally{await rm(root,{recursive:true,force:true})}
}
test('check mode leaves authorization files and directory unchanged',{skip:process.platform!=='linux'},()=>fixture(async({run,auth,sshdir,original})=>{
 const result=run('check','')
 assert.equal(result.status,0,result.stderr)
 assert.match(result.stdout,/absent\n$/)
 assert.equal(await readFile(auth,'utf8'),original)
 assert.deepEqual(await readdir(sshdir),['authorized_keys'])
}))
test('apply appends only the restricted expiring key, backs up and reconciles idempotently',{skip:process.platform!=='linux'},()=>fixture(async({run,auth,sshdir,original})=>{
 const until=expiry(deadline())
 const first=run('apply',until)
 assert.equal(first.status,0,first.stderr)
 const content=await readFile(auth,'utf8')
 assert.ok(content.startsWith(original))
 assert.ok(content.includes(`restrict,expiry-time="${until}" ssh-ed25519 ${blob} rue-infrastructure-${id}`))
 assert.equal(await readFile(join(sshdir,'rue-operator-backups',id+'.authorized_keys.before'),'utf8'),original)
 const second=run('apply',until)
 assert.equal(second.status,0,second.stderr)
 assert.match(second.stdout,/already-installed\n$/)
 assert.equal(await readFile(auth,'utf8'),content)
}))
test('refuses to override an existing identity with different restrictions',{skip:process.platform!=='linux'},()=>fixture(async({run,auth})=>{
 const content='ssh-ed25519 '+blob+' existing-grant\n'
 await writeFile(auth,content)
 assert.equal(run('apply').status,69)
 assert.equal(await readFile(auth,'utf8'),content)
}))
test('expired authorization never appends the identity',{skip:process.platform!=='linux'},()=>fixture(async({run,auth,original})=>{
 assert.equal(run('apply','20000101000000Z').status,68)
 assert.equal(await readFile(auth,'utf8'),original)
}))
