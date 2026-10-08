import {test,expect} from 'vitest'
import {createCoalescingWriter} from '../../src/session/coalescing-writer.js'

test('coalesces pending snapshots while preserving write order and flush completion',async()=>{
 const writes:string[]=[];let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 const writer=createCoalescingWriter(async(value:string)=>{writes.push(value);if(writes.length===1)await gate})
 writer.enqueue('a');writer.enqueue('ab');writer.enqueue('abc')
 let finished=false;const flushing=writer.flush().then(()=>{finished=true})
 await Promise.resolve();expect(finished).toBe(false);expect(writes).toEqual(['a'])
 release();await flushing;expect(writes).toEqual(['a','abc'])
 writer.enqueue('abcd');await writer.flush();expect(writes).toEqual(['a','abc','abcd'])
})
test('stream callbacks do not throw; failed writes reject flush and fence later snapshots',async()=>{
 const failure=new Error('fixture storage failure');let calls=0
 const writer=createCoalescingWriter(async(_value:string)=>{calls++;throw failure})
 expect(()=>writer.enqueue('first')).not.toThrow();writer.enqueue('second')
 await expect(writer.flush()).rejects.toBe(failure)
 writer.enqueue('third');await expect(writer.flush()).rejects.toBe(failure)
 expect(calls).toBe(1)
})
