import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {expect,test} from 'vitest'
import {MIGRATIONS} from '../../src/storage/schema.js'
import {createWorker} from '../../src/storage/workers.js'
import {createSession} from '../../src/storage/sessions.js'
test('retirement fences only obsolete bindings and preserves Mason, generic authority and history',()=>{
 const db=new Database(':memory:');db.pragma('foreign_keys=ON')
 try{
  for(const migration of MIGRATIONS.filter(m=>m.id<19))db.exec(migration.sql)
  const old=randomUUID(),current=randomUUID(),now=Date.now()
  for(const [id,kind] of [[old,'project'],[current,'generic']])db.prepare('INSERT INTO project_bindings(id,owner_subject,tenancy_origin,organization_id,project_id,key_id,key_hash,encrypted_key,scopes,expires_at,created_at,verified_at,authorized_until,authority_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'owner','https://tenancy.test','org_one','project_one','key_'+id,id,'encrypted-fixture','[]',now+60000,now,now,now+45000,kind)
  const mason=createWorker(db,'owner','Mason',randomUUID()),obsolete=createWorker(db,'owner','Obsolete',randomUUID(),now,old),generic=createWorker(db,'owner','Generic',randomUUID(),now,current)
  const history=createSession(db,{id:'ses_preserved',ownerSubject:'owner',title:'Preserved history'})
  const before=db.prepare('SELECT * FROM workers WHERE id=?').get(mason.worker.id),key=db.prepare('SELECT * FROM project_bindings WHERE id=?').get(current) as Record<string,unknown>
  db.transaction(()=>db.exec(MIGRATIONS.find(m=>m.id===19)!.sql))()
  expect(db.prepare('SELECT * FROM workers WHERE id=?').get(mason.worker.id)).toEqual(before)
  expect(db.prepare('SELECT revoked_at,project_binding_id FROM workers WHERE id=?').get(obsolete.worker.id)).toMatchObject({revoked_at:expect.any(Number),project_binding_id:null})
  expect(db.prepare('SELECT revoked_at,project_binding_id FROM workers WHERE id=?').get(generic.worker.id)).toEqual({revoked_at:null,project_binding_id:current})
  expect(db.prepare('SELECT id FROM project_bindings WHERE id=?').get(old)).toBeUndefined()
  expect(db.prepare('SELECT encrypted_key,key_hash FROM project_bindings WHERE id=?').get(current)).toEqual({encrypted_key:key.encrypted_key,key_hash:key.key_hash})
  expect(db.prepare('SELECT title FROM sessions WHERE id=?').get(history.id)).toEqual({title:'Preserved history'})
 }finally{db.close()}
})
