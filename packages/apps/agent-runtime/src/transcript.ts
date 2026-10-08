import {modelErrorMessage} from '../../../../extensions/rue/model-error.ts'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { Bridge, Message } from '../../../../extensions/rue/bridge.ts'

export function managedThinkingLevel(shareThinking: boolean, reasoning: boolean) {
  return shareThinking && reasoning ? 'medium' as const : 'off' as const
}

/** Use the same bridge snapshots and privacy gates as linked Pi agents. */
export function forwardTranscriptEvent(bridge: Bridge, event: AgentSessionEvent) {
  if(event.type==='compaction_start'||event.type==='compaction_end')bridge.activityChanged()
  if(event.type==='compaction_end'&&modelErrorMessage(event.errorMessage)){
    bridge.beginMessage({role:'assistant'})
    bridge.message({role:'assistant',content:[],stopReason:'error',errorMessage:event.errorMessage})
  }
  if(event.type==='message_start')bridge.beginMessage(event.message as Message)
  if(event.type==='message_update')bridge.message(event.message as Message,true)
  if(event.type==='message_end')bridge.message(event.message as Message)
  if(event.type==='tool_execution_start')bridge.tool(event,'start')
  if(event.type==='tool_execution_update')bridge.tool(event,'update')
  if(event.type==='tool_execution_end')bridge.tool(event,'end')
}
