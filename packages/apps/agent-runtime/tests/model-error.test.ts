import {test,expect,vi} from 'vitest'
import {Bridge} from '../../../../extensions/rue/bridge.ts'
import {modelErrorMessage} from '../../../../extensions/rue/model-error.ts'
import {TurnOutcome} from '../src/turn-outcome.js'
import {forwardTranscriptEvent} from '../src/transcript.js'
const makeBridge=()=>new Bridge({origin:'https://rue.test',id:'test',token:'test',piSessionId:'test',outbox:[],shareThinking:false,shareToolOutput:false},{save:vi.fn()},{idle:()=>true,send:vi.fn(),cancel:vi.fn(),notify:vi.fn(),confirm:async()=>false})
test.each([
 'Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.',
 'You exceeded your current quota, please check your plan and billing details.',
 'Your credit balance is too low. Please visit your billing dashboard.',
 'Rate limit reached. Try again in 42 seconds.',
 'Unknown vendor: model loading on shard 7; retry in 3 minutes.',
])('provider wording survives the relay unchanged: %s',error=>{
 const bridge=makeBridge(),mirror=vi.spyOn(bridge as any,'mirrorSnapshot')
 const message={role:'assistant',stopReason:'error',content:[],errorMessage:error}
 bridge.message(message,true);expect(mirror).not.toHaveBeenCalled()
 bridge.message(message)
 expect(mirror).toHaveBeenCalledTimes(1)
 expect(mirror.mock.calls[0]?.[0]).toBe(error)
 expect(mirror.mock.calls[0]?.[3]).toBe(true)
 expect(mirror.mock.calls[0]?.[6]).toBe('failed')
 const outcome=new TurnOutcome();outcome.observe({type:'message_end',message})
 expect(outcome.diagnostic).toBeUndefined()
 bridge.stop()
})
test('extract only the message from structured envelopes and redact credential formats',()=>{
 expect(modelErrorMessage(JSON.stringify({error:{message:'Exact provider text'},request:{secret:'not for sharing'}}))).toBe('Exact provider text')
 for(const input of ['Authorization: Bearer secret-fixture','x-api-key: secret-fixture','api_key="secret-fixture"','{"message":"refresh_token=secret-fixture"}','https://user:secret-fixture@example.test','sk-secret-fixture'])expect(modelErrorMessage(input)).not.toContain('secret-fixture')
 expect(modelErrorMessage('x'.repeat(70000))).toHaveLength(16384+'\n[Provider error truncated]'.length)
 for(const input of [null,{},'', '   '])expect(modelErrorMessage(input)).toBeUndefined()
})
test('empty errors retain generic failure, not fabricated provider text',()=>{
 const outcome=new TurnOutcome();outcome.observe({type:'message_end',message:{role:'assistant',stopReason:'error'}})
 expect(outcome.diagnostic).toContain('interrupted')
})
test('compaction lifecycle publishes fresh status and mirrors failure without summary or duplicate warning',()=>{
 const bridge=makeBridge(),activity=vi.spyOn(bridge,'activityChanged'),mirror=vi.spyOn(bridge as any,'mirrorSnapshot')
 forwardTranscriptEvent(bridge,{type:'compaction_start',reason:'threshold'})
 expect(activity).toHaveBeenCalledTimes(1)
 const event={type:'compaction_end' as const,reason:'threshold' as const,result:undefined,aborted:false,willRetry:false,errorMessage:'Provider: billing account suspended.'}
 forwardTranscriptEvent(bridge,event)
 expect(activity).toHaveBeenCalledTimes(2)
 expect(mirror.mock.calls[0]?.[0]).toBe(event.errorMessage)
 const outcome=new TurnOutcome();outcome.observe(event);expect(outcome.errorReported).toBe(true);expect(outcome.diagnostic).toBeUndefined()
 bridge.stop()
})
