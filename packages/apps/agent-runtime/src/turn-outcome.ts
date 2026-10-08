import {modelErrorNotice} from '../../../../extensions/rue/model-error.ts'
/** Unknown failures must not be mislabeled as missing credentials. */
export function runtimeFailureMessage(error:unknown){
 const message=typeof error==='string'?error:error instanceof Error?error.message:undefined
 return modelErrorNotice(message)??'The managed runtime could not complete this request and did not report a usable error detail. Review the transcript and runtime diagnostics before retrying. Some tools may already have run; no automatic retry was attempted.'
}
export class TurnOutcome {
 private finalReply=false
 private interrupted=false
 private credentialUnavailable=false
 private providerErrorReported=false
 get errorReported(){return this.providerErrorReported}
 observe(event:{type:string;errorMessage?:string;message?:{role:string;stopReason?:string;content?:unknown;errorMessage?:string}}){
  if(event.type==='compaction_end'&&modelErrorNotice(event.errorMessage)){this.providerErrorReported=true;return}
  if(event.type==='tool_execution_start'||event.type==='tool_execution_end')this.finalReply=false
  if(event.type!=='message_end'||event.message?.role!=='assistant')return
  const message=event.message
  const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.filter(part=>part.type==='text').map(part=>part.text??'').join(''):''
  this.interrupted=['error','aborted','length'].includes(message.stopReason??'')
  this.providerErrorReported=this.interrupted&&Boolean(modelErrorNotice(message.errorMessage))
  this.credentialUnavailable=this.interrupted&&typeof message.errorMessage==='string'&&message.errorMessage.includes('Rue shared provider key unavailable.')
  this.finalReply=Boolean(text.trim())&&!this.interrupted&&message.stopReason!=='toolUse'
 }
 get diagnostic(){return this.finalReply||this.providerErrorReported?undefined:this.credentialUnavailable?'The task could not continue because Rue’s shared provider credential service was unavailable. Some tools may already have run. Check the API connection and agent credential grant before retrying; do not assume the task completed.':this.interrupted?'The agent response was interrupted before a final reply. Some tools may already have run. Review the transcript before retrying.':'The agent stopped without a final reply. Tool completion does not mean the whole task finished. Review the transcript before retrying.'}
}
