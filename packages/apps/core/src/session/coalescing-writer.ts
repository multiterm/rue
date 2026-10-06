/** Bridge synchronous provider callbacks to ordered async persistence without an
 * unbounded queue. Intermediate snapshots coalesce; the latest must be flushed
 * before any final write or completion event. Failures are observed by flush(),
 * never as unhandled rejections from a void streaming callback. */
export function createCoalescingWriter<T extends {}>(write:(value:T)=>Promise<void>){
 let pending:T|undefined,busy=false,closed=false,current=Promise.resolve(),failure:{error:unknown}|undefined
 async function drain(){
  busy=true
  try{while(pending!==undefined){const value=pending;pending=undefined;await write(value)}}
  catch(error){failure={error};pending=undefined}
  finally{busy=false}
 }
 async function flush(){while(busy)await current;if(failure)throw failure.error}
 return {
  enqueue(value:T){if(failure||closed)return;pending=value;if(!busy)current=drain()},
  flush,
  close(){closed=true;return flush()},
 }
}
