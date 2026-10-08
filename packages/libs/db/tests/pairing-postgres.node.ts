import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createPostgresDatabase} from '../src/postgres/client.js'
import {migratePostgresDatabase} from '../src/postgres/migrate.js'
import {createPostgresPairingRepository} from '../src/postgres/pairing.js'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('PostgreSQL device ownership, single-winner pairing and concurrent preference CAS',{skip:!adminUrl},async()=>{
 const admin=createPostgresDatabase({url:adminUrl,maxConnections:1}),name='rue_test_'+randomUUID().replaceAll('-','')
 let database:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;database=createPostgresDatabase({url:url.toString(),maxConnections:4})
  await migratePostgresDatabase(database.db)
  const repo=createPostgresPairingRepository(database.db),now=1790000000123
  await repo.registerDevice('a',{id:'device',name:'First',platform:'web'},now)
  await assert.rejects(repo.registerDevice('b',{id:'device',name:'Stolen',platform:'web'},now),/owner_mismatch/)
  assert.equal((await repo.listDevices('a'))[0]!.name,'First');assert.deepEqual(await repo.listDevices('b'),[])
  assert.equal(await repo.revokeDevice('b','device',now),false)
  assert.equal(await repo.revokeDevice('a','device',now),true);assert.deepEqual(await repo.listDevices('a'),[])
  const registered=await repo.registerDevice('a',{id:'device',name:'Reactivated',platform:'web'},now+1)
  assert.equal(registered.createdAt,now);assert.equal(registered.revokedAt,null)
  await repo.createPairing('a',{id:'pair',tokenHash:'hash',codeHash:'code',expiresAt:now+100},now)
  assert.equal(await repo.getPairing('b','pair'),undefined);assert.equal(await repo.findPairing('b',{tokenHash:'hash'}),undefined)
  assert.equal((await repo.findPairing('a',{codeHash:'code'}))!.id,'pair')
  assert.equal(await repo.claimPairing('b','pair','other',now),false)
  const claims=await Promise.all([repo.claimPairing('a','pair','device',now),repo.claimPairing('a','pair','other',now)])
  assert.equal(claims.filter(Boolean).length,1)
  await repo.createPairing('a',{id:'expired',tokenHash:'hash-expired',codeHash:'code',expiresAt:now},now)
  assert.equal(await repo.claimPairing('a','expired','device',now),false)
  const first=await Promise.all([repo.setPreference('a','theme',{color:'blue'},'device',0,now),repo.setPreference('a','theme',{color:'red'},'device',0,now)])
  assert.equal(first.filter(Boolean).length,1)
  const updates=await Promise.all([repo.setPreference('a','theme',{color:'green'},'device',1,now+1),repo.setPreference('a','theme',{color:'gold'},'device',1,now+1)])
  assert.equal(updates.filter(Boolean).length,1)
  assert.equal((await repo.listPreferences('a'))[0]!.version,2);assert.deepEqual(await repo.listPreferences('b'),[])
  await Promise.all(Array.from({length:10},(_,i)=>repo.setPreference('a','counter',i)))
  assert.equal((await repo.listPreferences('a')).find(row=>row.key==='counter')!.version,10)
  await repo.setPreference('b','theme','separate',undefined,0,now)
  assert.equal((await repo.listPreferences('b'))[0]!.version,1)
  await assert.rejects(repo.listDevices(''),/owner_required/)
  await assert.rejects(repo.setPreference('a','theme',undefined),/value_invalid/)
 }finally{await database?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close()}
})
