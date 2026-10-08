import {expect,test} from 'vitest'
import {openDatabase,createSession,appendMessage,appendPart,getSession} from '../../src/storage/index.js'
import {clearSessionHistory} from '../../src/storage/history.js'
test('history clearing is owner-scoped, revision guarded, cascading, and preserves settings',()=>{
 const db=openDatabase(':memory:');try{
 createSession(db,{id:'chat',ownerSubject:'alice',title:'Keep',meta:{group:'Work'}})
 appendMessage(db,{id:'message',sessionId:'chat',role:'user'})
 appendPart(db,{id:'part',sessionId:'chat',messageId:'message',type:'text',payload:{text:'private'}})
 expect(()=>clearSessionHistory(db,'chat','bob','message')).toThrow('session_not_found')
 expect(()=>clearSessionHistory(db,'chat','alice',null)).toThrow('history_changed')
 expect(clearSessionHistory(db,'chat','alice','message')).toEqual({cleared:true})
 expect(db.prepare('SELECT * FROM parts').all()).toEqual([])
 expect(getSession(db,'chat','alice')).toMatchObject({title:'Keep',meta:{group:'Work'}})
 appendMessage(db,{id:'new',sessionId:'chat',role:'user'})
 expect(()=>clearSessionHistory(db,'chat','alice','message')).toThrow('history_changed')
 }finally{db.close()}
})
test('remote mirrors cannot be cleared independently of Pi memory',()=>{const db=openDatabase(':memory:');try{createSession(db,{id:'remote',ownerSubject:'alice',agent:'pi-terminal'});expect(()=>clearSessionHistory(db,'remote','alice',null)).toThrow('remote_history_reset_required')}finally{db.close()}})
