import {expect,test} from 'vitest'
import type {RueMessage,RuePart} from '../packages/libs/sdk/src/index'
import {indexTranscript} from '../packages/apps/webapp/src/transcript-index'
import {pullRequestLinks} from '../packages/apps/webapp/src/pull-request-actions'
const message=(id:string):RueMessage=>({id,sessionId:'session',role:'assistant',time:1,provider:null,model:null,agent:null,meta:{},seq:0})
const part=(id:string,messageId:string,payload:Record<string,unknown>,type='text'):RuePart=>({id,sessionId:'session',messageId,type,seq:0,payload})
test('transcript indexes chunks without duplicates, truncation or reasoning/tool ID collisions',()=>{
 const messages=['placeholder','tool-0','tool-1','thought','reply'].map(message),parts=[part('placeholder','placeholder',{text:'old',superseded:true}),part('tool-1','tool-1',{text:'second',tool:{id:'same',chunk:1}}),part('tool-0','tool-0',{text:'first',tool:{id:'same',chunk:0}}),part('thought','thought',{text:'reasoning',reasoning:{id:'same',chunk:0}},'reasoning'),part('reply','reply',{text:'complete'})]
 const rows=indexTranscript(messages,parts)
 expect(rows.map(row=>row.message.id)).toEqual(['tool-0','thought','reply'])
 expect(rows[0]!.parts.map(p=>p.id)).toEqual(['tool-0','tool-1'])
 expect(rows[1]!.parts.map(p=>p.id)).toEqual(['thought'])
 expect(rows[2]!.parts[0]).toBe(parts[4])
})
test('large chunk groups produce one complete card and unchanged parts keep their identity',()=>{
 const messages=Array.from({length:1000},(_,i)=>message(`m${i}`)),parts=messages.map((m,i)=>part(`p${i}`,m.id,{text:`chunk ${i}`,tool:{id:'large',chunk:i}}))
 const rows=indexTranscript(messages,parts);expect(rows).toHaveLength(1);expect(rows[0]!.parts).toHaveLength(1000)
 expect(rows[0]!.parts.every((part,i)=>part===parts[i])).toBe(true)
})
test('PR actions canonicalize actual GitHub URLs, including files links',()=>{
 expect(pullRequestLinks('See [PR](https://github.com/team/repo/pull/12). Also https://github.com/team/repo/pull/12/files?diff=split#top')).toEqual(['https://github.com/team/repo/pull/12'])
})
test('PR actions reject spoofed origins, partial IDs, credentials and embedded URLs',()=>{
 expect(pullRequestLinks(['https://github.com.evil.test/team/repo/pull/12','https://evil.test/https://github.com/team/repo/pull/12','https://evil@github.com/team/repo/pull/12','https://github.com/team/repo/pull/12-evil','https://github.com/team/repo/pull/12abc','https://github.com/team/repo/pull/12/unknown'].join(' '))).toEqual([])
 expect(pullRequestLinks(Array.from({length:20},(_,i)=>`https://github.com/team/repo/pull/${i+1}`).join(' '))).toHaveLength(3)
})
