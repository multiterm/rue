import {randomUUID} from 'node:crypto'
import {afterEach,expect,test,vi} from 'vitest'
import {ManagedCompactor,type CompactionDriver} from '../src/compaction.js'
afterEach(()=>vi.useRealTimers())
function setup(){
 let clock=0
 const driver:CompactionDriver={idle:vi.fn(()=>true),claim:vi.fn(async()=>({execute:true as const,nonce:'n'.repeat(43),serverNow:1000,deadline:121000})),compact:vi.fn(async()=>({summary:'private summary must not be acknowledged'})),persist:vi.fn(async()=>{}),acknowledge:vi.fn(async()=>{}),uncertain:vi.fn()}
 const executor=new ManagedCompactor(driver,()=>clock)
 return {driver,executor,setClock:(value:number)=>{clock=value}}
}
test('reserves locally before claiming, persists before ack and never sends summary content',async()=>{
 const {driver,executor}=setup(),order:string[]=[],id=randomUUID()
 driver.claim=vi.fn(async()=>{expect(executor.reserved).toBe(true);order.push('claim');return {execute:true,nonce:'n'.repeat(43),serverNow:1000,deadline:121000}})
 driver.compact=vi.fn(async()=>{order.push('compact');return {summary:'private summary'}})
 driver.persist=vi.fn(async()=>{order.push('persist')})
 driver.acknowledge=vi.fn(async()=>{expect(executor.reserved).toBe(true);order.push('ack')})
 expect(await executor.execute(id)).toBe('succeeded');expect(order).toEqual(['claim','compact','persist','ack'])
 expect(driver.acknowledge).toHaveBeenCalledWith(id,'n'.repeat(43),'succeeded',expect.any(AbortSignal));expect(executor.reserved).toBe(false)
 expect(await executor.execute(id)).toBe('seen');expect(driver.compact).toHaveBeenCalledTimes(1)
})
test('busy sessions are untouched, including work that appears while claiming',async()=>{
 const {driver,executor}=setup();driver.idle=()=>false
 expect(await executor.execute(randomUUID())).toBe('busy');expect(driver.claim).not.toHaveBeenCalled()
 let checks=0;driver.idle=()=>++checks===1
 expect(await executor.execute(randomUUID())).toBe('uncertain');expect(driver.compact).not.toHaveBeenCalled();expect(executor.reserved).toBe(true)
})
test('duplicate or unassigned claims never compact',async()=>{
 const {driver,executor}=setup();driver.claim=async()=>({execute:false})
 expect(await executor.execute(randomUUID())).toBe('not-assigned');expect(driver.compact).not.toHaveBeenCalled();expect(driver.acknowledge).not.toHaveBeenCalled();expect(executor.reserved).toBe(false)
})
test('two simultaneous invocations cannot claim or compact concurrently',async()=>{
 const {driver,executor}=setup();let finish!:()=>void
 driver.compact=vi.fn(()=>new Promise(resolve=>{finish=()=>resolve(undefined)}))
 const first=executor.execute(randomUUID());await vi.waitFor(()=>expect(driver.compact).toHaveBeenCalledOnce())
 expect(await executor.execute(randomUUID())).toBe('busy');finish();expect(await first).toBe('succeeded');expect(driver.claim).toHaveBeenCalledOnce()
})
test('a settled SDK failure is acknowledged without provider errors or automatic retry',async()=>{
 const {driver,executor}=setup(),id=randomUUID();driver.compact=vi.fn(async()=>{throw Error('private provider body')})
 expect(await executor.execute(id)).toBe('failed');expect(driver.acknowledge).toHaveBeenCalledWith(id,'n'.repeat(43),'failed',expect.any(AbortSignal))
 expect(await executor.execute(id)).toBe('seen');expect(driver.compact).toHaveBeenCalledOnce()
})
test.each(['claim','persist','acknowledge'] as const)('uncertain %s failure permanently holds this runtime',async method=>{
 const {driver,executor}=setup();driver[method]=vi.fn(async()=>{throw Error('uncertain')}) as never
 expect(await executor.execute(randomUUID())).toBe('uncertain');expect(driver.uncertain).toHaveBeenCalledOnce();expect(executor.reserved).toBe(true)
 expect(await executor.execute(randomUUID())).toBe('busy')
 if(method==='claim')expect(driver.compact).not.toHaveBeenCalled()
})
test('timeout aborts, fences and ignores a late summary instead of sending success',async()=>{
 vi.useFakeTimers();const {driver,executor,setClock}=setup();let finish!:(value:unknown)=>void,signal!:AbortSignal
 driver.compact=vi.fn(s=>{signal=s;return new Promise(resolve=>{finish=resolve})})
 const result=executor.execute(randomUUID());await vi.advanceTimersByTimeAsync(1);setClock(120001);await vi.advanceTimersByTimeAsync(120000)
 expect(await result).toBe('uncertain');expect(signal.aborted).toBe(true);expect(executor.reserved).toBe(true)
 finish({summary:'late private output'});await vi.advanceTimersByTimeAsync(1);expect(driver.acknowledge).not.toHaveBeenCalled()
})
test('lost claim replies are bounded and never execute late',async()=>{
 vi.useFakeTimers();const {driver,executor}=setup();let finish!:(value:any)=>void
 driver.claim=()=>new Promise(resolve=>{finish=resolve})
 const result=executor.execute(randomUUID());await vi.advanceTimersByTimeAsync(10001);expect(await result).toBe('uncertain')
 finish({execute:true,nonce:'n'.repeat(43),serverNow:1000,deadline:121000});await vi.advanceTimersByTimeAsync(1)
 expect(driver.compact).not.toHaveBeenCalled();expect(executor.reserved).toBe(true)
})
test('authority loss aborts in-flight work without acknowledgement or releasing the prompt gate',async()=>{
 const {driver,executor}=setup();driver.compact=vi.fn(()=>new Promise(()=>{}))
 const result=executor.execute(randomUUID());await vi.waitFor(()=>expect(driver.compact).toHaveBeenCalledOnce());executor.stop()
 expect(await result).toBe('uncertain');expect(executor.reserved).toBe(true);expect(driver.acknowledge).not.toHaveBeenCalled()
})
test('malformed and exhausted execution tickets fail closed',async()=>{
 const {driver,executor,setClock}=setup();driver.claim=async()=>{setClock(120001);return {execute:true,nonce:'n'.repeat(43),serverNow:1000,deadline:121000}}
 expect(await executor.execute(randomUUID())).toBe('uncertain');expect(driver.compact).not.toHaveBeenCalled()
 const other=setup();other.driver.claim=async()=>({execute:true,nonce:'bad',serverNow:1000,deadline:121000})
 expect(await other.executor.execute(randomUUID())).toBe('uncertain');expect(other.driver.compact).not.toHaveBeenCalled()
})
