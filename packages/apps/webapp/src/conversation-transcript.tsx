import {memo,useMemo,useDeferredValue,Fragment} from 'react'
import type {RueMessage,RuePart} from '@multiterm/rue-sdk'
import {ChatMessage} from './chat-message'
import {ConversationDate} from './conversation-date'
import {indexTranscript} from './transcript-index'
/** Typing and unrelated dashboard updates must not reparse the transcript. */
type TranscriptProps={messages:RueMessage[];parts:RuePart[];active:boolean;botTitle?:string}
const TranscriptRows=memo(function TranscriptRows({messages,parts,active,botTitle}:TranscriptProps){
 const rows=useMemo(()=>indexTranscript(messages,parts),[messages,parts])
 return <>{rows.map(({message,parts},index)=><Fragment key={message.id}><ConversationDate time={message.time} previous={rows[index-1]?.message.time}/><ChatMessage botTitle={botTitle} message={message} parts={parts} active={active&&message.role==='assistant'&&message.id===messages.at(-1)?.id}/></Fragment>)}</>
})
/** Prioritize selection/composer commits over cached Markdown rendering.
 * Never render the previous agent's messages beneath the new agent's header. */
export const ConversationTranscript=memo(function ConversationTranscript({sessionId,...props}:TranscriptProps&{sessionId:string}){
 const input=useMemo(()=>({sessionId,...props}),[sessionId,props.messages,props.parts,props.active,props.botTitle])
 const deferred=useDeferredValue(input)
 if(deferred.sessionId!==sessionId)return <p role="status">Opening conversation…</p>
 return <TranscriptRows messages={deferred.messages} parts={deferred.parts} active={deferred.active} botTitle={deferred.botTitle}/>
})
