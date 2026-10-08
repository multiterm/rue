import {useEffect,useRef,useState,type ComponentType} from 'react'
import type {RueSession,RueRemoteComputer,RueMessage,RuePart} from '@multiterm/rue-sdk'
import {Button,Dialog,SearchIcon,Separator,MenuSettingsIcon,MenuStatusIcon,MenuActionsIcon,MenuWorkspaceIcon,MenuPermissionsIcon,MenuConnectionIcon,MenuRoutinesIcon,MenuRuntimeIcon,MenuRefreshIcon,MenuClearIcon,MenuDeleteIcon} from '@multiterm/rue-ui'
import type {SettingsPage} from './bot-settings'
import {isRemoteBot} from './bot-execution'
import {AgentSync} from './agent-sync'
import {ConversationSearch,searchMessageAnchor} from './conversation-search'
function SearchMenuIcon(){return <SearchIcon size={16} className="size-4 fill-none stroke-current stroke-2" aria-hidden/>}
export function ConversationMenu({session,computer,messages=[],parts=[],searchLoading=false,searchFailed=false,onSearchResult,observedAt,clearDisabled,open,manage,refresh,clear,remove}:{session?:RueSession;computer?:RueRemoteComputer;messages?:RueMessage[];parts?:RuePart[];searchLoading?:boolean;searchFailed?:boolean;onSearchResult?(target:HTMLElement):void;observedAt:number;clearDisabled:boolean;open(page:SettingsPage):void;manage():void;refresh():Promise<unknown>;clear():void;remove():void}){
 const details=useRef<HTMLDetailsElement>(null),[refreshing,setRefreshing]=useState(false)
 const [searchOpen,setSearchOpen]=useState(false),[search,setSearch]=useState(''),[searchError,setSearchError]=useState('')
 const wasSearching=useRef(false),searchTarget=useRef<{id:string;sessionId:string}|null>(null)
 useEffect(()=>{setSearchOpen(false);setSearch('');setSearchError('');searchTarget.current=null},[session?.id])
 useEffect(()=>{
  if(searchOpen){wasSearching.current=true;return}
  if(!wasSearching.current)return
  wasSearching.current=false
  const target=searchTarget.current;searchTarget.current=null;let second=0
  const first=requestAnimationFrame(()=>{
   const element=target&&target.sessionId===session?.id?document.getElementById(`message-${target.id}`):null
   if(element){element.querySelector<HTMLElement>('[tabindex]')?.focus({preventScroll:true});second=requestAnimationFrame(()=>{if(onSearchResult)onSearchResult(element);else element.scrollIntoView({block:'center',behavior:'auto'})})}
   else details.current?.querySelector<HTMLElement>('summary')?.focus({preventScroll:true})
  })
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second)}
 },[searchOpen,session?.id,onSearchResult])
 function jumpToMessage(id:string){
  if(!session)return
  const anchor=searchMessageAnchor(id,parts.filter(part=>part.sessionId===session.id))
  if(!document.getElementById(`message-${anchor}`)){setSearchError('This result is no longer visible. Refresh the conversation and try again.');return}
  searchTarget.current={id:anchor,sessionId:session.id};setSearchOpen(false)
 }
 const managed=Boolean(session?.meta.managedAgentId),remote=Boolean(session&&isRemoteBot(session))
 function action(fn:()=>void){details.current?.removeAttribute('open');fn()}
 function item(label:string,Icon:ComponentType<{size?:number;'aria-hidden'?:boolean;colorMode?:'stripped';className?:string}>,fn:()=>void,disabled=false,danger=false){return <Button type="button" variant="bare" disabled={disabled} className={danger?'danger-menu-item':undefined} onClick={()=>action(fn)}><Icon size={16} colorMode="stripped" className="size-4 fill-none stroke-current stroke-2" aria-hidden/>{label}</Button>}
 async function reload(){if(refreshing)return;setRefreshing(true);try{await refresh()}catch{/* Query errors remain visible. */}finally{setRefreshing(false)}}
 return <><details ref={details}><summary aria-label="Workspace options">•••</summary><div className="workspace-menu">
 {item('Settings',MenuSettingsIcon,()=>open('Settings'),!session)}
 {item('Search',SearchMenuIcon,()=>{setSearchError('');setSearchOpen(true)},!session)}
 {(remote||managed)&&item('Status',MenuStatusIcon,()=>open('Status'))}
 {(remote||managed)&&item('Expired Requests',MenuRoutinesIcon,()=>open('Expired queue'))}
 {item('Connection',MenuConnectionIcon,()=>open('Connection'),!session)}
 {item('Routines',MenuRoutinesIcon,()=>open('Routines'),!session)}
 {managed&&<><Separator/>{item('Actions',MenuActionsIcon,()=>open('Actions'))}{item('Workspace',MenuWorkspaceIcon,()=>open('Workspace'))}{item('Permissions',MenuPermissionsIcon,()=>open('Permissions'))}{item('Manage runtime',MenuRuntimeIcon,manage)}</>}
 {session&&computer&&<AgentSync key={session.id} sessionId={session.id} computer={computer} observedAt={observedAt}/>}
 <Separator/>{item('Refresh',MenuRefreshIcon,()=>void reload(),refreshing||!session)}
 {item('Clear history',MenuClearIcon,clear,!session||(!remote&&!managed&&clearDisabled))}
 {item('Delete bot',MenuDeleteIcon,remove,!session,true)}
 </div></details>
 <Dialog open={searchOpen&&Boolean(session)} onClose={()=>setSearchOpen(false)} title="Search" description={`Search loaded messages in ${session?.title||'this conversation'}.`} className="max-h-[calc(100dvh-40px)] overflow-y-auto">
 {searchLoading?<p role="status">Loading conversation…</p>:searchFailed?<div className="grid gap-3"><p role="alert">Could not load this conversation for search.</p><Button type="button" variant="ghost" disabled={refreshing} onClick={()=>void reload()}>Refresh conversation</Button></div>:<ConversationSearch messages={messages.filter(message=>message.sessionId===session?.id)} parts={parts.filter(part=>part.sessionId===session?.id)} value={search} onChange={value=>{setSearch(value);setSearchError('')}} onSelect={jumpToMessage}/>}
 {searchError&&<p role="alert">{searchError}</p>}
 </Dialog></>
}
