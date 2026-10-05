import {describe,expect,test,vi} from 'vitest'
import {Bridge} from '../../../../extensions/rue/bridge.ts'
import {forwardTranscriptEvent,managedThinkingLevel} from '../src/transcript.js'

describe('managed chat parity',()=>{
 test('thinking requires consent and a reasoning-capable model',()=>{
  expect(managedThinkingLevel(true,true)).toBe('medium')
  expect(managedThinkingLevel(false,true)).toBe('off')
  expect(managedThinkingLevel(true,false)).toBe('off')
 })
 test.each([true,false])('SDK events respect transcript sharing: %s',share=>{
  const bridge=new Bridge({origin:'https://rue.test',id:'fixture',token:'fixture',piSessionId:'fixture',outbox:[],shareToolOutput:share,shareThinking:share},{save:vi.fn()},{idle:()=>true,send:vi.fn(),cancel:vi.fn(),notify:vi.fn(),confirm:async()=>false})
  // Keep snapshots local: no network connection is needed to verify forwarding.
  const mirror=vi.spyOn(bridge as any,'mirrorSnapshot')
  const emit=(event:unknown)=>forwardTranscriptEvent(bridge,event as Parameters<typeof forwardTranscriptEvent>[1])
  const message={role:'assistant',content:[{type:'thinking',thinking:'Visible reasoning summary'}]}
  emit({type:'message_start',message})
  emit({type:'message_update',message})
  emit({type:'message_end',message})
  emit({type:'tool_execution_start',toolCallId:'call',toolName:'read',args:{path:'README.md'}})
  emit({type:'tool_execution_update',toolCallId:'call',toolName:'read',partialResult:{content:[{type:'text',text:'partial output'}]}})
  emit({type:'tool_execution_end',toolCallId:'call',toolName:'read',result:{content:[{type:'text',text:'final output'}]},isError:false})
  emit({type:'message_end',message:{role:'toolResult',toolCallId:'call',toolName:'read',content:[{type:'text',text:'final output'}],isError:false}})
  if(share){
   expect(mirror.mock.calls.some(call=>call[0]==='Visible reasoning summary'&&call[3]===false)).toBe(true)
   expect(mirror.mock.calls.some(call=>String(call[0]).includes('final output')&&call[3]===true)).toBe(true)
  }else expect(mirror).not.toHaveBeenCalled()
  bridge.stop()
 })
})
