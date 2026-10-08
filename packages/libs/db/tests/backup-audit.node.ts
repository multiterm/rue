import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,chmodSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {MIGRATIONS} from '../../../apps/core/src/storage/schema.ts'
import {auditSqliteBackup} from '../scripts/audit-sqlite-backup.mjs'
function fixture(run:(path:string)=>void){
 const root=mkdtempSync(join(tmpdir(),'rue-backup-audit-')),path=join(root,'backup.db'),db=new DatabaseSync(path)
 try{for(const migration of MIGRATIONS){db.exec(migration.sql);db.prepare('INSERT INTO migrations VALUES(?,?,?)').run(migration.id,migration.name,1)}db.close();chmodSync(path,0o600);run(path)}finally{rmSync(root,{recursive:true,force:true})}
}
test('audit matches every table without modifying the backup or claiming cutover readiness',()=>fixture(path=>{
 const hash=()=>createHash('sha256').update(readFileSync(path)).digest('hex'),before=hash(),result=auditSqliteBackup(path)
 assert.equal(result.schemaMatches,true);assert.equal(result.cutoverReady,false);assert.equal(result.requiresExecutionReconciliation,false)
 assert.equal(Object.keys(result.tableCounts).length,38);assert.equal(hash(),before)
}))
test('WAL-mode backup headers are refused without creating sidecars or changing bytes',()=>fixture(path=>{
 const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL');db.close()
 assert.equal(existsSync(path+'-wal'),false);assert.equal(existsSync(path+'-shm'),false)
 const before=readFileSync(path);assert.equal(before[18],2)
 assert.throws(()=>auditSqliteBackup(path),/standalone_delete_journal_backup_required/)
 assert.deepEqual(readFileSync(path),before);assert.equal(existsSync(path+'-wal'),false);assert.equal(existsSync(path+'-shm'),false)
}))
test('execution state is counted without printing credentials or renewing leases',()=>fixture(path=>{
 const db=new DatabaseSync(path)
 db.prepare("INSERT INTO workers(id,owner_subject,name,token_hash,enrollment_request_id,desired,revision,generation,instance_id,lease_expires_at,created_at) VALUES('w','owner','private-name','private-token','request','active',1,1,'instance',999,1)").run();db.close()
 const result=auditSqliteBackup(path);assert.equal(result.executionState.workerLeases,1);assert.equal(result.requiresExecutionReconciliation,true)
 assert.equal(JSON.stringify(result).includes('private-'),false)
}))
test('cross-owner relationships are rejected even when foreign keys are valid',()=>fixture(path=>{
 const db=new DatabaseSync(path)
 db.exec("INSERT INTO sessions(id,title,created_at,updated_at,owner_subject) VALUES('s','',1,1,'owner-a'); INSERT INTO terminal_connections(id,owner_subject,session_id,pi_session_id,token_hash,expires_at,created_at) VALUES('c','owner-b','s','pi','hash',2,1)")
 db.close();assert.throws(()=>auditSqliteBackup(path),/owner_relationship_mismatch/)
}))
test('unknown columns and schema versions block a silent partial migration',()=>fixture(path=>{
 const db=new DatabaseSync(path);db.exec('ALTER TABLE sessions ADD COLUMN future_data TEXT');db.close()
 assert.throws(()=>auditSqliteBackup(path),/column_inventory_mismatch/)
}))
test('foreign-key violations and unsafe backup files are refused',()=>fixture(path=>{
 chmodSync(path,0o644);assert.throws(()=>auditSqliteBackup(path),/private_owned/);chmodSync(path,0o600)
 const link=path+'.link';symlinkSync(path,link);assert.throws(()=>auditSqliteBackup(link),/private_owned/)
 const db=new DatabaseSync(path);db.exec("PRAGMA foreign_keys=OFF; INSERT INTO messages(id,session_id,role,time,seq) VALUES('m','absent','user',1,1)");db.close()
 assert.throws(()=>auditSqliteBackup(path),/foreign_keys_invalid/)
}))
