import test from 'node:test'
import assert from 'node:assert/strict'
import {createECDH} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,statSync,chmodSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {preparePushRuntime} from '../scripts/deployment/prepare-push-runtime.mjs'
import {runtimeSelection,applicationEnvironment,decodePushRuntime} from '../scripts/deployment/api-secret-runtime.mjs'

const codec=await import(process.env.RUE_TEST_ENVX_MODULE??'@multiterm/envx')
const wrapping=codec.generateKeyPair(),vapid=createECDH('prime256v1');vapid.generateKeys()
const values={RUE_PUSH_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url'),RUE_PUSH_PUBLIC_KEY:vapid.getPublicKey().toString('base64url'),RUE_PUSH_SUBJECT:'mailto:operator@example.test'}
const encode=record=>Object.entries(record).map(([key,value])=>`${key}="${codec.encryptValueAsymmetric(value,wrapping.publicKey)}"`).join('\n')
const ciphertext=encode(values)

test('requires explicit runtime and API bootstrap credentials; no implicit opt-in',()=>{
 assert.equal(runtimeSelection({}),null)
 for(const env of [{RUE_SECRET_SOURCE:'other'},{RUE_SECRET_SOURCE:'dotlocker'},{RUE_SECRET_SOURCE:'dotlocker',RUE_SECRET_RUNTIME:'../../prod'},{RUE_SECRET_SOURCE:'dotlocker',RUE_SECRET_RUNTIME:'dev',DOTLOCKER_TOKEN:'fake'}])assert.throws(()=>runtimeSelection(env))
 assert.deepEqual(runtimeSelection({RUE_SECRET_SOURCE:'dotlocker',RUE_SECRET_RUNTIME:'dev',DOTLOCKER_TOKEN:'fake',ENVX_PRIVATE_KEY_DEV:'fake'}),{runtime:'dev',keyName:'ENVX_PRIVATE_KEY_DEV'})
})
test('real Envx ciphertext decrypts unchanged VAPID keys without public variable mirroring',async()=>{
 assert.deepEqual(await decodePushRuntime(ciphertext,wrapping.privateKey,{},codec),values)
 assert.deepEqual(await decodePushRuntime(ciphertext,wrapping.privateKey,values,codec),values)
})
test('missing, plaintext, malformed, mismatched and conflicting keys fail without disclosing values',async()=>{
 for(const [text,key,existing] of [
  [ciphertext,codec.generateKeyPair().privateKey,{}],
  [ciphertext,wrapping.privateKey,{RUE_PUSH_PUBLIC_KEY:'existing-key-must-survive'}],
  [encode({...values,RUE_PUSH_PUBLIC_KEY:'invalid-private-test-value'}),wrapping.privateKey,{}],
  [encode({RUE_PUSH_PRIVATE_KEY:values.RUE_PUSH_PRIVATE_KEY}),wrapping.privateKey,{}],
  [Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n'),wrapping.privateKey,{}],
  [ciphertext+'\nVITE_PRIVATE_KEY=bad',wrapping.privateKey,{}],
  [ciphertext+'\nRUE_PUSH_PRIVATE_KEY=duplicate',wrapping.privateKey,{}],
  [ciphertext+'\nmalformed declaration',wrapping.privateKey,{}],
  [encode({...values,RUE_PUSH_SUBJECT:'https://username:password@example.test/path'}),wrapping.privateKey,{}],
 ])await assert.rejects(decodePushRuntime(text,key,existing,codec),error=>{
  assert.equal(error.message,'Encrypted API push configuration is invalid, incomplete, or conflicts with existing keys; values withheld')
  assert.ok(!error.message.includes(values.RUE_PUSH_PRIVATE_KEY));return true
 })
})
test('PostgreSQL API secrets are an encrypted all-or-nothing tuple preserving the original key',async()=>{
 const database={RUE_STORAGE_BACKEND:'postgres',RUE_DATABASE_URL:'postgres://fixture:fixture-password@database.test/rue',RUE_SETTINGS_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')}
 assert.deepEqual(await decodePushRuntime(encode({...values,...database}),wrapping.privateKey,{},codec),{...values,...database})
 for(const invalid of [{...database,RUE_STORAGE_BACKEND:'sqlite'},{...database,RUE_SETTINGS_ENCRYPTION_KEY:'invalid'},{...database,RUE_DATABASE_URL:'https://example.test'},{RUE_DATABASE_URL:database.RUE_DATABASE_URL}])await assert.rejects(decodePushRuntime(encode({...values,...invalid}),wrapping.privateKey,{},codec))
 await assert.rejects(decodePushRuntime(encode({...values,...database}),wrapping.privateKey,{RUE_DATABASE_URL:'postgres://other:secret@other.test/rue'},codec))
})
test('offline migration preserves VAPID identity, isolates the wrapping key and never overwrites a bundle',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'rue-push-migration-test-'))
 try{
  const source=join(directory,'existing.env'),destination=join(directory,'bundle')
  const original=Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')
  writeFileSync(source,original,{mode:0o600})
  await preparePushRuntime('dev',source,destination,codec)
  assert.equal(readFileSync(source,'utf8'),original)
  assert.deepEqual(readdirSync(join(destination,'payload')),['.env'])
  const key=codec.toRecord(codec.parseEnv(readFileSync(join(destination,'bootstrap.env'),'utf8'))).ENVX_PRIVATE_KEY_DEV
  const payload=readFileSync(join(destination,'payload','.env'),'utf8')
  assert.ok(!payload.includes(key));assert.ok(!payload.includes(values.RUE_PUSH_PRIVATE_KEY))
  assert.deepEqual(await decodePushRuntime(payload,key,{},codec),values)
  assert.equal(statSync(join(destination,'bootstrap.env')).mode&0o777,0o600)
  await assert.rejects(preparePushRuntime('dev',source,destination,codec))
  assert.equal(readFileSync(join(destination,'payload','.env'),'utf8'),payload)
  chmodSync(source,0o644)
  await assert.rejects(preparePushRuntime('dev',source,join(directory,'unsafe'),codec))
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('application inherits its configuration but not bootstrap credentials or wildcard envelopes',()=>{
 assert.deepEqual(applicationEnvironment({...values,PORT:'4097',DOTLOCKER_TOKEN:'hidden',ENVX_PRIVATE_KEY_DEV:'hidden',DOTENV_PRIVATE_KEY:'hidden',SANDBLOCKS_APP_ENVIRONMENTS:'hidden'}),{...values,PORT:'4097'})
})
test('disabled bootstrap starts normally; enabled but incomplete bootstrap never starts API',()=>{
 const script=new URL('../scripts/deployment/api-secret-runtime.mjs',import.meta.url)
 const args=[script.pathname,'--',process.execPath,'-e','console.log("API_STARTED")']
 const clean=applicationEnvironment(process.env);delete clean.RUE_SECRET_SOURCE
 const legacy=spawnSync(process.execPath,args,{env:clean,encoding:'utf8'})
 assert.equal(legacy.status,0);assert.equal(legacy.stdout.trim(),'API_STARTED')
 const blocked=spawnSync(process.execPath,args,{env:{...clean,RUE_SECRET_SOURCE:'dotlocker',RUE_SECRET_RUNTIME:'dev'},encoding:'utf8'})
 assert.equal(blocked.status,1);assert.equal(blocked.stdout,'');assert.match(blocked.stderr,/credentials were not logged/)
})
