import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,chmodSync,readFileSync,rmSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {sql} from 'drizzle-orm'
import {MIGRATIONS} from '../../../apps/core/src/storage/schema.ts'
import {createPostgresDatabase} from '../src/postgres/client.ts'
import {migratePostgresDatabase} from '../src/postgres/migrate.ts'
import {rehearseSqliteBackup,createHeldImportFixture,importCutoverBackup} from '../scripts/rehearse-sqlite-backup.ts'
import {resetImportedExecutionState,ImportResetBlocked} from '../scripts/import-execution-reset.ts'
import {restoreFingerprint} from '../scripts/restore-fingerprint.ts'
import {execFileSync} from 'node:child_process'
const adminUrl=process.env.RUE_PG_TEST_ADMIN_URL

test('rollback-only SQLite copy rehearsal against PostgreSQL',{skip:!adminUrl},async t=>{
 const root=mkdtempSync(join(tmpdir(),'rue-rehearsal-')),path=join(root,'backup.db'),source=new DatabaseSync(path)
 const name='rue_rehearsal_'+randomUUID().replaceAll('-',''),admin=createPostgresDatabase({url:adminUrl,maxConnections:1})
 let database:ReturnType<typeof createPostgresDatabase>|undefined,created=false
 try{
  for(const migration of MIGRATIONS){source.exec(migration.sql);source.prepare('INSERT INTO migrations VALUES(?,?,?)').run(migration.id,migration.name,1)}
  source.exec(`INSERT INTO sessions(id,title,created_at,updated_at,owner_subject,meta) VALUES('s','private title',1790000000123,1790000000123,'owner','{"decimal":0.12345678901234567890123456789,"large":9007199254740993}');
   INSERT INTO messages(id,session_id,role,time,seq,meta) VALUES('m','s','user',1790000000123,1,'{"nested":{"a":true,"b":null}}');
   INSERT INTO parts(id,session_id,message_id,type,seq,payload) VALUES('p','s','m','text',1,'{"text":"private message"}');
   INSERT INTO notebooks(id,name,path,updated_at) VALUES(100,'private notebook','/private/notebook',1790000000123);
   INSERT INTO notebook_files(id,notebook_id,relative_path,text) VALUES(201,100,'a.md','private notebook body');
   INSERT INTO agent_settings(owner_subject,settings,encrypted_key,revision) VALUES('owner','{}','opaque-original-ciphertext',7);
   INSERT INTO workers(id,owner_subject,name,token_hash,enrollment_request_id,desired,revision,generation,instance_id,lease_expires_at,created_at) VALUES('w','owner','private host','private-token-hash','req','active',1,1,'instance',1790000009999,1790000000123);
   INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at) VALUES('c','owner','s','pi','private-relay-hash',1790000009999,1790000000123);
   INSERT INTO managed_agents(id,owner_subject,worker_id,session_id,connection_id,name,config,desired,created_at) VALUES('a','owner','w','s','c','private agent','{}','running',1790000000123);
   INSERT INTO managed_operations(id,owner_subject,request_id,intent,agent_id,revision,action,status,created_at) VALUES('op','owner','req','{}','a',1,'create','pending',1790000000123);`)
  source.exec(`INSERT INTO project_bindings(id,owner_subject,tenancy_origin,organization_id,project_id,key_id,key_hash,encrypted_key,scopes,expires_at,created_at,verified_at,authorized_until) VALUES('binding','owner','https://tenancy.test','org','project','key','key-hash','opaque-project-credential','[]',1790000999999,1,1,1790000999999);
   UPDATE workers SET project_binding_id='binding';
   UPDATE managed_agents SET encrypted_grant='opaque-transient-grant',grant_revision=1,grant_generation=1,grant_boot=1,observed='running',observed_revision=1,observed_generation=1,observed_at=1;
   INSERT INTO runtime_control_grants(agent_id,owner_subject,worker_id,connection_id,revision,enabled,expires_at,updated_at) VALUES('a','owner','w','c',1,1,1790000999999,1);
   INSERT INTO device_pairings(id,owner_subject,token_hash,code_hash,created_at,expires_at) VALUES('pair','owner','pair-hash','code-hash',1,1790000999999);
   INSERT INTO terminal_pairing_requests(id,verifier_hash,pi_session_id,expires_at) VALUES('terminal-pair','verifier','pi',1790000999999);
   INSERT INTO oauth_login_intents(owner_subject,id,expected_revision,status,created_at,expires_at) VALUES('owner','intent',0,'pending',1,1790000999999);`)
  source.prepare('UPDATE parts SET payload=?').run(JSON.stringify({text:'private message',nul:'a'+String.fromCharCode(0)+'b',surrogate:String.fromCharCode(0xd800)},null,2))
  source.close();chmodSync(path,0o600)
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;created=true
  const url=new URL(adminUrl!);url.pathname='/'+name;database=createPostgresDatabase({url:url.toString(),maxConnections:1});await migratePostgresDatabase(database.db)
  const db=database.db,hash=()=>createHash('sha256').update(readFileSync(path)).digest('hex')
  await t.test('all tables, FK ordering, JSON precision/Unicode, opaque strings and rowids copy and roll back',async()=>{
   const before=hash(),report=await rehearseSqliteBackup(path,db,name)
   assert.equal(report.tables,37);assert.equal(report.rows,15);assert.equal(report.rolledBack,true);assert.equal(report.cutoverReady,false);assert.equal(report.requiresExecutionReconciliation,true)
   assert.equal(report.counts.managed_operations,1);assert.equal(hash(),before)
   assert.equal(JSON.stringify(report).includes('private'),false);assert.equal(JSON.stringify(report).includes('opaque'),false)
   assert.equal((await db.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM sessions`))[0]!.n,0)
   // Explicitly imported source IDs/rowids do not consume identity sequences.
   const [sequence]=await db.execute<{is_called:boolean}>(sql`SELECT is_called FROM managed_operations_ordinal_seq`)
   assert.equal(sequence!.is_called,false)
  })
  await t.test('explicit cutover refuses missing confirmation, stale snapshots and a running API coordinator',async()=>{
   const target='rue_test_'+randomUUID().replaceAll('-',''),targetUrl=new URL(adminUrl!);targetUrl.pathname='/'+target
   await admin.sql`CREATE DATABASE ${admin.sql(target)}`
   const destination=createPostgresDatabase({url:targetUrl.toString(),maxConnections:1}),holder=createPostgresDatabase({url:targetUrl.toString(),maxConnections:1})
   try{
    await migratePostgresDatabase(destination.db)
    const confirmation={expectedDatabase:target,sourceSha256:hash(),acknowledgeStoppedWriters:true,acknowledgeExecutionHold:true}
    await assert.rejects(importCutoverBackup(path,destination.db,{...confirmation,acknowledgeStoppedWriters:false}),/cutover_confirmation_required/)
    await assert.rejects(importCutoverBackup(path,destination.db,{...confirmation,sourceSha256:'0'.repeat(64)}),/cutover_source_hash_mismatch/)
    await assert.rejects(createHeldImportFixture(path,destination.db,target),/disposable_database_required/)
    await holder.sql`SELECT pg_advisory_lock(hashtextextended('rue:core-coordinator',0))`
    await assert.rejects(importCutoverBackup(path,destination.db,confirmation),/cutover_coordinator_in_use/)
    await holder.close()
    await assert.rejects(importCutoverBackup(path,destination.db,confirmation),error=>error instanceof ImportResetBlocked)
    assert.equal((await destination.sql`SELECT count(*)::integer AS n FROM sessions`)[0]!.n,0)
    // Resolve only this synthetic fixture's pending operation, then pin the new hash.
    const edited=new DatabaseSync(path);edited.exec("UPDATE managed_operations SET status='succeeded'");edited.close()
    const report=await importCutoverBackup(path,destination.db,{...confirmation,sourceSha256:hash()})
    assert.equal(report.committedForCutover,true);assert.equal(report.committedForRestore,false);assert.equal(report.cutoverReady,false)
    assert.equal(report.executionReset?.executionHeld,true)
    assert.equal((await destination.sql`SELECT desired FROM workers`)[0]!.desired,'draining')
    await assert.rejects(importCutoverBackup(path,destination.db,{...confirmation,sourceSha256:hash()}),/target_not_empty/)
   }finally{
    await holder.close();await destination.close();await admin.sql`DROP DATABASE ${admin.sql(target)} WITH (FORCE)`
    const original=new DatabaseSync(path);original.exec("UPDATE managed_operations SET status='pending'");original.close()
   }
  })
  await t.test('nonempty or mismatched targets are refused without modifying their data',async()=>{
   await assert.rejects(rehearseSqliteBackup(path,db,'production'),/disposable_database_required/)
   await assert.rejects(rehearseSqliteBackup(path,db,'rue_rehearsal_'+'0'.repeat(32)),/identity_mismatch/)
   await db.execute(sql`INSERT INTO notebooks(id,name,path,updated_at) VALUES(1,'retain me','/retain',1)`)
   await assert.rejects(rehearseSqliteBackup(path,db,name),/target_not_empty/)
   assert.equal((await db.execute<{name:string}>(sql`SELECT name FROM notebooks`))[0]!.name,'retain me')
   await db.execute(sql`DELETE FROM notebooks`)
  })
  await t.test('failed conversion is sanitized and all earlier inserts roll back',async()=>{
   const change=new DatabaseSync(path);change.exec("UPDATE parts SET payload='private-invalid-json'");change.close()
   await assert.rejects(rehearseSqliteBackup(path,db,name),error=>error instanceof Error&&error.message==='rehearsal_copy_failed'&&!JSON.stringify(error).includes('private-invalid-json'))
   assert.equal((await db.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM sessions`))[0]!.n,0)
  })
  await t.test('committed restore fixtures refuse pending work, hold execution and reseed identities',async()=>{
   const change=new DatabaseSync(path);change.prepare('UPDATE parts SET payload=?').run(JSON.stringify({text:'preserved'+String.fromCharCode(0,0xd800)}));change.close()
   await assert.rejects(createHeldImportFixture(path,db,name),error=>error instanceof ImportResetBlocked&&error.blockers.some(b=>b.kind==='managed_operations'&&b.n===1))
   assert.equal((await db.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM sessions`))[0]!.n,0)
   const drained=new DatabaseSync(path);drained.exec("UPDATE managed_operations SET status='succeeded',completed_at=1790000000124");drained.close()
   const report=await createHeldImportFixture(path,db,name)
   assert.equal(report.rolledBack,false);assert.equal(report.committedForRestore,true);assert.equal(report.cutoverReady,false)
   assert.equal(report.executionReset!.changed.workers,1);assert.equal(report.executionReset!.changed.agents,1)
   assert.deepEqual((await db.execute(sql`SELECT desired,instance_id,lease_expires_at,health FROM workers`))[0],{desired:'draining',instance_id:null,lease_expires_at:null,health:null})
   assert.deepEqual((await db.execute(sql`SELECT desired,observed,encrypted_grant FROM managed_agents`))[0],{desired:'stopped',observed:'pending',encrypted_grant:null})
   assert.equal((await db.execute<{value:string}>(sql`SELECT encrypted_key AS value FROM agent_settings`))[0]!.value,'opaque-original-ciphertext')
   assert.equal(report.executionReset!.changed.delegations,1);assert.equal(report.executionReset!.changed.projectProofs,1)
   assert.equal(report.executionReset!.changed.devicePairings,1);assert.equal(report.executionReset!.changed.terminalPairings,1);assert.equal(report.executionReset!.changed.oauthIntents,1)
   assert.deepEqual((await db.execute(sql`SELECT revision::int AS revision,generation::int AS generation,token_hash FROM workers`))[0],{revision:2,generation:2,token_hash:'private-token-hash'})
   assert.deepEqual((await db.execute(sql`SELECT expires_at::int AS expires,remote_enabled::int AS enabled FROM terminal_connections`))[0],{expires:0,enabled:0})
   assert.deepEqual((await db.execute(sql`SELECT authorized_until::int AS until,encrypted_key FROM project_bindings`))[0],{until:0,encrypted_key:'opaque-project-credential'})
   const before=await restoreFingerprint(db)
   const repeated=await db.transaction(tx=>resetImportedExecutionState(tx,name));assert.equal(Object.values(repeated.changed).every(n=>n===0),true)
   assert.deepEqual(await restoreFingerprint(db),before)
   await assert.rejects(resetImportedExecutionState(db,name)) // LOCK refuses autocommit misuse.
   await assert.rejects(db.transaction(async tx=>{await tx.execute(sql`UPDATE workers SET desired='active'`);await resetImportedExecutionState(tx,name);throw Error('force rollback')}),/force rollback/)
   assert.deepEqual(await restoreFingerprint(db),before)
   await assert.rejects(db.transaction(async tx=>{await tx.execute(sql`INSERT INTO scheduled_tasks(id,prompt,when_ms) VALUES('future','do not discard',1)`);await resetImportedExecutionState(tx,name)}),error=>error instanceof ImportResetBlocked&&error.blockers.some(b=>b.kind==='scheduled_tasks'))
   assert.deepEqual(await restoreFingerprint(db),before)
   const blockedCases=[
    ['terminal_commands',sql`INSERT INTO terminal_commands(id,connection_id,request_id,text,user_message_id,assistant_message_id,status,created_at,updated_at,ordinal) VALUES('pending','c','pending','never replay','m','m','queued',1,1,123)`],
    ['managed_compactions',sql`INSERT INTO managed_compactions(id,owner_subject,request_id,agent_id,revision,generation,boot,status,created_at,expires_at,ordinal) VALUES('compact','owner','compact','a',1,1,1,'uncertain',1,2,123)`],
    ['runtime_rollouts',sql`INSERT INTO runtime_rollouts(id,owner_subject,worker_id,request_id,intent,phase,image,previous_image,worker_revision,created_at,updated_at,expires_at,phase_at) VALUES('rollout','owner','w','rollout','{}','uncertain','image','previous',1,1,1,2,1)`],
    ['agent_updates_or_purges',sql`UPDATE managed_agents SET runtime_update_state='updating'`],
    ['oauth_refresh',sql`INSERT INTO provider_oauth_credentials(owner_subject,provider,encrypted_credential,state,refresh_nonce) VALUES('owner','openai-codex','opaque-refresh','refreshing','nonce')`],
   ] as const
   for(const [kind,query] of blockedCases){
    await assert.rejects(db.transaction(async tx=>{await tx.execute(query);await resetImportedExecutionState(tx,name)}),error=>error instanceof ImportResetBlocked&&error.blockers.some(b=>b.kind===kind))
    assert.deepEqual(await restoreFingerprint(db),before)
   }
   await assert.rejects(db.transaction(async tx=>{await tx.execute(sql`UPDATE workers SET generation=${Number.MAX_SAFE_INTEGER}`);await resetImportedExecutionState(tx,name)}),/unsafe_counter/)
   assert.deepEqual(await restoreFingerprint(db),before)
   assert.deepEqual(before.sequences.notebooks_id_seq,{lastValue:'101',called:false})
   assert.deepEqual(before.sequences.notebook_files_id_seq,{lastValue:'202',called:false})
  })
  await t.test('private on-disk pg_dump restores every row and identity into another database',{skip:!process.env.RUE_PG_TEST_CONTAINER},async()=>{
   const container=process.env.RUE_PG_TEST_CONTAINER!,context=process.env.RUE_PG_TEST_DOCKER_CONTEXT??'colima-rue',user=new URL(adminUrl!).username
   assert.match(container,/^rue-pg-[a-zA-Z0-9-]+$/);assert.match(user,/^[a-zA-Z0-9_]+$/)
   const run=(args:string[],input?:Buffer)=>{try{return execFileSync('docker',['--context',context,'exec',...(input?['-i']:[]),container,...args],{input,maxBuffer:64*1024*1024,timeout:30000,stdio:['pipe','pipe','pipe']})}catch{throw Error('restore_fixture_command_failed')}}
   const before=await restoreFingerprint(db),archive=join(root,'fixture.dump'),fd=openSync(archive,'wx',0o600)
   try{const bytes=run(['pg_dump','-U',user,'--format=custom','--no-owner','--no-privileges',name]);let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd)}finally{closeSync(fd)}
   const restoredName='rue_restore_'+randomUUID().replaceAll('-','');await admin.sql`CREATE DATABASE ${admin.sql(restoredName)}`
   const restoredUrl=new URL(adminUrl!);restoredUrl.pathname='/'+restoredName;const restored=createPostgresDatabase({url:restoredUrl.toString(),maxConnections:1})
   try{
    run(['pg_restore','-U',user,'--exit-on-error','--single-transaction','--no-owner','--no-privileges','-d',restoredName],readFileSync(archive))
    assert.deepEqual(await restoreFingerprint(restored.db),before)
    const hold=await restored.db.transaction(tx=>resetImportedExecutionState(tx,restoredName));assert.equal(Object.values(hold.changed).every(n=>n===0),true)
    assert.deepEqual(await restoreFingerprint(restored.db),before)
    const [next]=await restored.db.execute<{id:string}>(sql`INSERT INTO notebooks(name,path,updated_at) VALUES('next','/next',1) RETURNING id::text AS id`);assert.equal(next!.id,'101')
   }finally{await restored.close();await admin.sql`DROP DATABASE ${admin.sql(restoredName)}`}
  })
 }finally{await database?.close();if(created)await admin.sql`DROP DATABASE ${admin.sql(name)}`;await admin.close();rmSync(root,{recursive:true,force:true})}
})
