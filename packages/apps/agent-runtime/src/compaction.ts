export type CompactClaim={execute:false}|{execute:true;nonce:string;serverNow:number;deadline:number}
export interface CompactionDriver {
 idle():boolean
 claim(id:string,signal:AbortSignal):Promise<CompactClaim>
 compact(signal:AbortSignal):Promise<unknown>
 /** Flush the existing Pi session and directory before acknowledging success. */
 persist():Promise<void>
 acknowledge(id:string,nonce:string,outcome:'succeeded'|'failed',signal:AbortSignal):Promise<void>
 /** The production adapter must terminate/fence the runtime, not release the prompt gate. */
 uncertain():void
}
/** Single local reservation around a durable, single-use core claim. The adapter
 * must include `reserved` in its relay idle predicate. Never sends model prompts,
 * custom instructions, summary contents, provider errors or credentials to Rue. */
export class ManagedCompactor {
 private held=false
 private halted=false
 private readonly seen=new Set<string>()
 private readonly abort=new AbortController()
 get reserved(){return this.held||this.halted}
 constructor(private readonly driver:CompactionDriver,private readonly now=()=>performance.now()){}
 stop(){this.halted=true;this.held=true;this.abort.abort()}
 private uncertain(){this.stop();try{this.driver.uncertain()}catch{/* Remain fenced even if shutdown reporting fails. */}return 'uncertain' as const}
 private async bounded<T>(work:(signal:AbortSignal)=>Promise<T>,milliseconds:number):Promise<T>{
  if(this.abort.signal.aborted||!Number.isFinite(milliseconds)||milliseconds<=0)throw Error('compaction_fenced')
  const local=new AbortController(),signal=AbortSignal.any([this.abort.signal,local.signal])
  let timer:ReturnType<typeof setTimeout>|undefined,abortListener:(()=>void)|undefined
  const cancelled=new Promise<never>((_,reject)=>{
   abortListener=()=>reject(Error('compaction_fenced'));signal.addEventListener('abort',abortListener,{once:true})
   timer=setTimeout(()=>local.abort(),milliseconds)
  })
  try{return await Promise.race([Promise.resolve().then(()=>{if(signal.aborted)throw Error('compaction_fenced');return work(signal)}),cancelled])}
  finally{clearTimeout(timer);if(abortListener)signal.removeEventListener('abort',abortListener);local.abort()}
 }
 async execute(id:string):Promise<'busy'|'seen'|'not-assigned'|'succeeded'|'failed'|'uncertain'>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('compaction_request_invalid')
  if(this.reserved||!this.driver.idle())return 'busy'
  if(this.seen.has(id))return 'seen'
  if(this.seen.size>=1000)return this.uncertain()
  this.held=true
  const began=this.now()
  try{
   const claim=await this.bounded(signal=>this.driver.claim(id,signal),10000)
   this.seen.add(id)
   if(this.halted)return 'uncertain'
   if(!claim.execute){this.held=false;return 'not-assigned'}
   const ttl=claim.deadline-claim.serverNow
   if(!Number.isSafeInteger(claim.serverNow)||!Number.isSafeInteger(claim.deadline)||ttl<=0||ttl>120000||!/^[A-Za-z0-9_-]{43}$/.test(claim.nonce))return this.uncertain()
   const until=began+ttl
   if(this.now()>=until||this.halted)return this.uncertain()
   // Pi's manual compact aborts active work. Never call it if any work appeared
   // while claiming, even when the server's last health sample said idle.
   let outcome:'succeeded'|'failed'='failed'
   if(this.driver.idle()){
    try{await this.bounded(signal=>this.driver.compact(signal),until-this.now());outcome='succeeded'}
    catch{if(this.now()>=until||this.halted)return this.uncertain()}
   }
   if(!this.driver.idle())return this.uncertain()
   await this.bounded(()=>this.driver.persist(),Math.min(10000,until-this.now()))
   await this.bounded(signal=>this.driver.acknowledge(id,claim.nonce,outcome,signal),Math.min(10000,until-this.now()))
   if(this.halted)return 'uncertain'
   this.held=false;return outcome
  }catch{return this.uncertain()}
 }
}
