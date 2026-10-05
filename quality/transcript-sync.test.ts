import {expect,test} from 'vitest'
import {transcriptUpsert,upsertParts,reconcileParts,reconcileMessages} from '../packages/apps/webapp/src/transcript-sync'
const message={id:'m',sessionId:'s',role:'assistant' as const,time:1,seq:1,meta:{},model:null,provider:null,agent:null}
const part=(v:number,text='text')=>({id:'p',messageId:'m',sessionId:'s',type:'text',seq:0,payload:{text,mirrorVersion:v,mirrorFinal:v===3}})
test('live transcript upserts are session-bound and structurally validated',()=>{
 expect(transcriptUpsert({sessionId:'s',upsert:{message,parts:[part(1)]}})?.message.id).toBe('m')
 expect(transcriptUpsert({sessionId:'other',upsert:{message,parts:[part(1)]}})).toBeUndefined()
 expect(transcriptUpsert({sessionId:'s',upsert:{message:{...message,role:['assistant']},parts:[]}})).toBeUndefined()
 expect(transcriptUpsert({sessionId:'s',upsert:{message,parts:[{...part(1),messageId:'different'}]}})).toBeUndefined()
})
test('late snapshots and duplicate/out-of-order pushes cannot roll back newer mirrored text',()=>{
 const first=[part(1)],latest=upsertParts(first,[part(3,'final')])
 expect(upsertParts(latest,[part(2,'stale')])).toBe(latest)
 expect(upsertParts(latest,[part(3,'duplicate')])).toBe(latest)
 expect(reconcileParts([part(2)],first,latest)[0].payload.text).toBe('final')
})
test('authoritative reads discard earlier cache but retain new messages received during the read',()=>{
 const before=[message],after=[message,{...message,id:'new',seq:2}]
 expect(reconcileMessages([],before,before)).toEqual([])
 expect(reconcileMessages(before,before,after).map(m=>m.id)).toEqual(['m','new'])
 const previous=[part(1)]
 expect(reconcileParts([],previous,previous)).toEqual([])
})
