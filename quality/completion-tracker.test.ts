import {expect,test} from 'vitest'
import {CompletionTracker} from '../packages/apps/webapp/src/completion-tracker'
test('alerts only for observed task completions, not historic results or repeated snapshots',()=>{
 const tracker=new CompletionTracker()
 const run=(id:string,status:string)=>({id,status,updated_at:1})
 expect(tracker.observe([run('old','completed'),run('live','running')])).toEqual([])
 expect(tracker.observe([run('old','completed'),run('live','completed')]).map(r=>r.id)).toEqual(['live'])
 expect(tracker.observe([run('live','completed')])).toEqual([])
 expect(tracker.observe([run('other','failed')])).toEqual([])
 expect(tracker.observe([])).toEqual([])
 expect(tracker.observe([run('unseen','completed')])).toEqual([])
})
