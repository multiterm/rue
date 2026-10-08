import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import type {Database} from 'better-sqlite3'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {verifyRestoredCredentials} from '../scripts/verify-restored-credentials.ts'
import {restoreFingerprint} from '../scripts/restore-fingerprint.ts'
import {agentSettings,providerKeys,providerOauthCredentials,mcpProfiles,projectBindings,pushSubscriptions} from '../src/postgres/schema.ts'
import {encryptCredential,decryptCredential} from '../../../apps/core/src/storage/agent-settings.ts'
import {eq,sql} from 'drizzle-orm'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('restored credentials authenticate with the original checkpoint key, never returning plaintext',{skip:!adminUrl},async()=>{
 const name='rue_restore_'+randomUUID().replaceAll('-',''),admin=createPostgresDatabase({url:adminUrl,maxConnections:1})
 const dir=await mkdtemp(join(tmpdir(),'rue-credential-check-')),keyContext={name:join(dir,'checkpoint.db')} as Database
 const prior=process.env.RUE_SETTINGS_ENCRYPTION_KEY;delete process.env.RUE_SETTINGS_ENCRYPTION_KEY
 let pool:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  await writeFile(keyContext.name+'.agent-key',Buffer.alloc(32,17),{mode:0o600})
  const secret='private-test-value-never-report',seal=(scope:string[])=>encryptCredential(keyContext,scope,secret)
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;pool=createPostgresDatabase({url:url.toString(),maxConnections:1});await migratePostgresDatabase(pool.db)
  const db=pool.db
  const empty=await verifyRestoredCredentials(db,name,()=>{throw Error('must_not_decrypt')})
  assert.equal(empty.total,0);assert.equal(empty.credentialDecryptionVerified,false)
  await db.insert(agentSettings).values({ownerSubject:'owner',settings:'{}',encryptedKey:seal(['owner','openai']),revision:0})
  await db.insert(providerKeys).values({ownerSubject:'owner',provider:'anthropic',encryptedKey:seal(['owner','provider-key','anthropic']),revision:0})
  await db.insert(providerOauthCredentials).values({ownerSubject:'owner',provider:'openai-codex',state:'ready',encryptedCredential:seal(['owner','provider-oauth','openai-codex'])})
  await db.insert(mcpProfiles).values({id:'mcp',ownerSubject:'owner',name:'test',command:'false',args:'[]',encryptedEnv:seal(['owner','mcp-profile','mcp']),createdAt:1})
  await db.insert(projectBindings).values({id:'binding',ownerSubject:'owner',tenancyOrigin:'https://tenancy.test',organizationId:'org',projectId:'project',keyId:'key',keyHash:'hash',encryptedKey:seal(['owner','project-binding','binding','https://tenancy.test']),scopes:'[]',expiresAt:0,createdAt:1,verifiedAt:0,authorizedUntil:0})
  await db.insert(pushSubscriptions).values({id:'push',ownerSubject:'owner',deviceId:'device',endpointHash:'hash',encryptedSubscription:seal(['owner','web-push','push']),createdAt:1,updatedAt:1,expiresAt:0})
  const before=await restoreFingerprint(db),decrypt=(scope:string[],value:string)=>decryptCredential(keyContext,scope,value)
  const report=await verifyRestoredCredentials(db,name,decrypt)
  assert.equal(report.total,6);assert.equal(report.credentialDecryptionVerified,true)
  assert.ok(Object.values(report.checked).every(n=>n===1));assert.equal(JSON.stringify(report).includes(secret),false)
  assert.deepEqual(await restoreFingerprint(db),before)
  await db.execute(sql`ALTER TABLE public.provider_keys ADD COLUMN encrypted_unreviewed text`)
  await assert.rejects(verifyRestoredCredentials(db,name,decrypt),/^Error: restored_credential_verification_failed$/)
  await db.execute(sql`ALTER TABLE public.provider_keys DROP COLUMN encrypted_unreviewed`)
  await assert.rejects(verifyRestoredCredentials(db,'rue_production',decrypt),/disposable_database_required/)
  await assert.rejects(verifyRestoredCredentials(db,'rue_restore_'+randomUUID().replaceAll('-',''),decrypt),/^Error: restored_credential_verification_failed$/)
  await rm(keyContext.name+'.agent-key')
  await assert.rejects(verifyRestoredCredentials(db,name,decrypt),/^Error: restored_credential_verification_failed$/)
  await writeFile(keyContext.name+'.agent-key',Buffer.alloc(32,18),{mode:0o600})
  await assert.rejects(verifyRestoredCredentials(db,name,decrypt),/^Error: restored_credential_verification_failed$/)
  await writeFile(keyContext.name+'.agent-key',Buffer.alloc(32,17))
  await db.update(providerKeys).set({ownerSubject:'other-owner'}).where(eq(providerKeys.ownerSubject,'owner'))
  await assert.rejects(verifyRestoredCredentials(db,name,decrypt),/^Error: restored_credential_verification_failed$/)
  await assert.rejects(verifyRestoredCredentials(db,name,()=>{throw Error(secret)}),error=>error instanceof Error&&error.message==='restored_credential_verification_failed'&&error.cause===undefined)
  await db.execute(sql`INSERT INTO public.workers(id,owner_subject,name,token_hash,enrollment_request_id,created_at) VALUES('worker','owner','host','fixture-hash','fixture-request',1)`)
  await db.execute(sql`INSERT INTO public.managed_agents(id,owner_subject,worker_id,name,config,desired,created_at,encrypted_grant) VALUES('agent','owner','worker','agent','{}','stopped',1,${seal(['owner','managed-agent','agent'])})`)
  let calls=0
  const held=await restoreFingerprint(db)
  await assert.rejects(verifyRestoredCredentials(db,name,()=>{calls++;return secret}),/^Error: restored_credential_verification_failed$/)
  assert.equal(calls,0);assert.deepEqual(await restoreFingerprint(db),held)
 }finally{
  if(prior===undefined)delete process.env.RUE_SETTINGS_ENCRYPTION_KEY;else process.env.RUE_SETTINGS_ENCRYPTION_KEY=prior
  await pool?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close();await rm(dir,{recursive:true,force:true})
 }
})
