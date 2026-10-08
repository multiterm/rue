import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react'
import type { RueSession } from '@multiterm/rue-sdk'
import { Button, Checkbox, Input, Label, Scrollbar, Separator, SidePanelHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@multiterm/rue-ui'
import { rue } from './client'
import {BotAvatar} from './bots'
import {BotAiPage,BotConnectionPage,type BotAccountPage} from './bot-settings-pages'
import {AgentUsagePage} from './agent-usage'
import {BotAgentStatus} from './bot-agent-status'
import {QueueRecoveryPage} from './queue-recovery'
import {BotAgentActions,type AgentActionView} from './bot-agent-actions'
import {initialSettingsHistory,settingsNavigate,settingsEntryPage,settingsPageTitles,settingsBackLabel,type SettingsPage,type SettingsNavigation} from './bot-settings-navigation'
export type {SettingsPage} from './bot-settings-navigation'
import './bot-experience.css'

export const colorNames = ['default', 'green', 'amber', 'orange', 'purple', 'blue', 'teal'] as const
export function botOrganization(session: RueSession) {
  const { group, labels, botColor, bubbleColor } = session.meta
  return { group: typeof group === 'string' ? group.slice(0, 60) : '', labels: Array.isArray(labels) ? labels.filter((v): v is string => typeof v === 'string').slice(0, 8).map(v => v.slice(0, 32)) : [], botColor: colorNames.some(color => color === botColor) ? String(botColor) : 'default', bubbleColor: colorNames.some(color => color === bubbleColor) ? String(bubbleColor) : 'default' }
}
export function colorToken(name: string) { const index = colorNames.findIndex(color => color === name); return index > 0 ? `var(--rue-bot-${index})` : undefined }
function Chevron(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>}
export function BotSettings({ session, close, saved,manage,initialPage='Settings',initialAction='actions',navigationRequest=0 }: { session: RueSession; close(): void; saved(): void;manage(page:BotAccountPage):void;initialPage?:SettingsPage;initialAction?:AgentActionView;navigationRequest?:number }) {
  const initial = botOrganization(session)
  const [pinned,setPinned]=useState(session.meta.pinned===true),[archived,setArchived]=useState(session.meta.archived===true)
  const [name, setName] = useState(session.title), [group, setGroup] = useState(initial.group), [labels, setLabels] = useState(initial.labels.join(', ')), [botColor, setBotColor] = useState(initial.botColor), [bubbleColor, setBubbleColor] = useState(initial.bubbleColor), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const draft=session.meta.routineDraft as Record<string,unknown>|undefined
  const [routinePrompt,setRoutinePrompt]=useState(typeof draft?.prompt==='string'?draft.prompt:''),[routineTime,setRoutineTime]=useState(typeof draft?.time==='string'?draft.time:'08:00'),[routineZone,setRoutineZone]=useState(typeof draft?.timezone==='string'?draft.timezone:Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [history,setHistory]=useState(()=>initialSettingsHistory(settingsEntryPage(initialPage,initialAction)))
  const page=history.at(-1)!,backPage=history.at(-2),previousPage=useRef<SettingsPage>(page)
  const [pendingPage,setPendingPage]=useState<SettingsPage|null>(null),[direction,setDirection]=useState<'forward'|'back'>('forward')
  const pendingNavigation=useRef<SettingsNavigation|null>(null),scrollViewport=useRef<HTMLDivElement>(null),scrollPositions=useRef<Partial<Record<SettingsPage,number>>>({})
  const [actionView,setActionView]=useState<AgentActionView>(settingsEntryPage(initialPage,initialAction)==='Actions'?initialAction:'actions'),[actionRequest,setActionRequest]=useState(navigationRequest)
  const handledRequest=useRef({page:initialPage,action:initialAction,id:navigationRequest})
  function startNavigation(action:SettingsNavigation){
    if(busy||pendingPage||pendingNavigation.current)return false
    const next=settingsNavigate(history,action);if(next===history)return false
    scrollPositions.current[page]=scrollViewport.current?.scrollTop??0
    setDirection(action.type==='back'?'back':'forward')
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)setHistory(current=>settingsNavigate(current,action))
    else{pendingNavigation.current=action;setPendingPage(next.at(-1)!)}
    return true
  }
  function navigate(next:SettingsPage){const changed=startNavigation({type:'push',page:next});if(changed)setActionView('actions');return changed}
  function back(){if(startNavigation({type:'back'}))setActionView('actions')}
  function finishExit(){const action=pendingNavigation.current;if(!action)return;pendingNavigation.current=null;setHistory(current=>settingsNavigate(current,action));setPendingPage(null)}
  useEffect(()=>{if(!pendingPage)return;const timer=setTimeout(finishExit,200);return()=>clearTimeout(timer)},[pendingPage])
  useLayoutEffect(()=>{if(scrollViewport.current)scrollViewport.current.scrollTop=scrollPositions.current[page]??0},[page])
  useEffect(()=>{
    const previous=handledRequest.current
    if(previous.page===initialPage&&previous.action===initialAction&&previous.id===navigationRequest)return
    if(busy||pendingPage)return
    const target=settingsEntryPage(initialPage,initialAction)
    if(target!==page)startNavigation({type:'push',page:target})
    handledRequest.current={page:initialPage,action:initialAction,id:navigationRequest}
    setActionView(target==='Actions'?initialAction:'actions');setActionRequest(navigationRequest)
  },[initialPage,initialAction,navigationRequest,busy,pendingPage,page])
  const mounted=useRef(true)
  const heading=useId(),panel=useRef<HTMLElement>(null),latest=useRef({busy,close});latest.current={busy:busy||Boolean(pendingPage),close}
  useEffect(()=>{
    mounted.current=true
    const element=panel.current,parent=element?.parentElement,chat=parent?.querySelector<HTMLElement>('.chat-main');if(!element||!parent||!chat)return
    const previous=document.activeElement as HTMLElement|null,summary=parent.querySelector<HTMLElement>('summary[aria-label="Workspace options"]')
    const focus=()=>{if(!document.querySelector('[role="dialog"]'))element.querySelector<HTMLElement>('[data-settings-page],h2')?.focus({preventScroll:true})}
    const resize=()=>{const overlay=parent.clientWidth<860;parent.dataset.settingsOverlay=String(overlay);chat.inert=overlay;if(overlay&&chat.contains(document.activeElement))focus()}
    const observer=new ResizeObserver(resize);observer.observe(parent);resize();focus()
    const keydown=(event:KeyboardEvent)=>{if(event.key==='Tab'&&parent.dataset.settingsOverlay==='true'&&element.contains(document.activeElement)&&!document.querySelector('[role="dialog"]')){const controls=Array.from(element.querySelectorAll<HTMLElement>('button,input,textarea,select,[tabindex]')).filter(node=>node.tabIndex>=0&&!node.matches(':disabled')&&node.getClientRects().length);if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus()}else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus()}}if(event.key==='Escape'&&!event.defaultPrevented&&element.contains(document.activeElement)&&!document.querySelector('[role="dialog"]')&&!latest.current.busy){event.preventDefault();latest.current.close()}}
    window.addEventListener('keydown',keydown)
    return()=>{mounted.current=false;observer.disconnect();window.removeEventListener('keydown',keydown);chat.inert=false;delete parent.dataset.settingsOverlay;if(element.contains(document.activeElement)||document.activeElement===document.body){const target=previous?.isConnected&&previous.getClientRects().length?previous:summary;target?.focus({preventScroll:true})}}
  },[])
  useEffect(()=>{if(previousPage.current!==page){const target=(direction==='back'?panel.current?.querySelector<HTMLElement>(`[data-settings-page="${previousPage.current}"]`):undefined)??panel.current?.querySelector<HTMLElement>('h2');if(!document.querySelector('[role="dialog"]'))target?.focus({preventScroll:true});previousPage.current=page}},[page])
  async function save() {
    setBusy(true); setError('')
    try {
      new Intl.DateTimeFormat(undefined,{timeZone:routineZone}).format()
      const current = await rue.session(session.id)
      if (current.ownerSubject !== session.ownerSubject) throw Error('Account changed')
      await rue.updateSession(session.id, { title: name.trim(), meta: { ...current.meta, pinned, archived, group: group.trim(), labels: [...new Set(labels.split(',').map(v => v.trim()).filter(Boolean))].slice(0, 8).map(v => v.slice(0, 32)), botColor, bubbleColor, routineDraft:{prompt:routinePrompt.trim(),time:routineTime,timezone:routineZone,enabled:false} } })
      saved(); if(mounted.current)close()
    } catch { setError('Could not save bot settings. Your draft has been kept. Check your account and retry.') }
    finally { setBusy(false) }
  }
  return <><div className="bot-settings-backdrop" aria-hidden="true" onClick={()=>{if(!busy&&!pendingPage)close()}}/><aside ref={panel} role="complementary" aria-label="Settings" className="bot-settings-drawer"><SidePanelHeader className="bot-settings-heading" title={settingsPageTitles[page]} subtitle={session.title||'Bot'} headingId={heading} onBack={backPage?back:undefined} backLabel={backPage?settingsBackLabel(backPage):'Back'} onClose={close} closeLabel="Close settings" disabled={busy||Boolean(pendingPage)}/><form onSubmit={e => { e.preventDefault(); void save() }}>
    <fieldset disabled={busy||Boolean(pendingPage)} className="contents"><Scrollbar orientations={['vertical']} viewportRef={scrollViewport} className="bot-settings-scroll"><div key={page} className="bot-settings-fields bot-settings-page-content" data-direction={direction} data-phase={pendingPage?'exit':'enter'} aria-busy={Boolean(pendingPage)} onAnimationEnd={event=>{if(event.target===event.currentTarget&&event.animationName==='rue-settings-page-exit')finishExit()}}>
      {page==='Settings'&&<>
      <div className="bot-appearance-preview"><BotAvatar size="lg" color={colorToken(botColor)}/></div>
      <div role="group" aria-label="Bot color" className="bot-color-swatches">{colorNames.map(color=><Button key={color} type="button" variant="bare" aria-label={`Use ${color} bot color`} aria-pressed={botColor===color} className="bot-color-swatch" style={{background:colorToken(color)??'var(--rue-muted)'}} onClick={()=>setBotColor(color)}/>)}</div>
      <Input label="Bot name" value={name} maxLength={60} onChange={e => setName(e.target.value)} show={{ label: true, hideRequireType: true }}/>
      <Input label="Group" placeholder="e.g. Work" value={group} maxLength={60} onChange={e => setGroup(e.target.value)} show={{ label: true, hideRequireType: true }}/>
      <Input label="Labels" placeholder="research, daily" value={labels} maxLength={270} onChange={e => setLabels(e.target.value)} show={{ label: true, hideRequireType: true }}/><small>Comma-separated; up to 8 labels.</small>
      {([{ label: 'Chat bubble color', value: bubbleColor, set: setBubbleColor }]).map(field => <div key={field.label}><Label>{field.label}</Label><Select value={field.value} onValueChange={field.set}><SelectTrigger aria-label={field.label}><SelectValue/></SelectTrigger><SelectContent>{colorNames.map(color => <SelectItem key={color} value={color}>{color}</SelectItem>)}</SelectContent></Select></div>)}
      <label className="flex items-center gap-2"><Checkbox checked={pinned} onCheckedChange={checked=>setPinned(checked===true)}/>Pin bot to the top</label>
      <label className="flex items-center gap-2"><Checkbox checked={archived} onCheckedChange={checked=>setArchived(checked===true)}/>Archive bot from the active list</label>
      <small>Archiving hides the conversation; it does not stop the agent or delete history. Use the bot-list filter to show archived bots and restore them.</small>
      <Separator/>
      <nav aria-label="Bot settings pages" className="bot-settings-pages">{(['Routines','Connection','AI settings','Usage',...(session.agent==='pi-terminal'||session.terminalConnectionId||session.meta.managedAgentId?['Status','Expired queue']:[]),...(typeof session.meta.managedAgentId==='string'?['Actions','Workspace','Permissions']:[])] as SettingsPage[]).map(label=><Button key={label} type="button" variant="outline" className="bot-settings-page-link" aria-label={label==='Expired queue'?settingsPageTitles[label]:label} data-settings-page={label} onClick={()=>navigate(label)}><span>{label==='Expired queue'?settingsPageTitles[label]:label}</span><Chevron/></Button>)}</nav>
      </>}
      {page==='Connection'&&<BotConnectionPage session={session} manage={manage}/>}
      {page==='AI settings'&&<BotAiPage session={session} manage={manage}/>}
      {page==='Usage'&&<AgentUsagePage session={session}/>}
      {page==='Status'&&<BotAgentStatus session={session}/>}
      {page==='Expired queue'&&<QueueRecoveryPage session={session} onBusy={setBusy}/>}
      {(['Actions','Workspace','Permissions'] as SettingsPage[]).includes(page)&&<BotAgentActions key={page==='Actions'?`${page}:${actionView}:${actionRequest}`:page} initialView={page==='Workspace'?'workspace':page==='Permissions'?'permissions':actionView} session={session} onBusy={setBusy} onNavigate={view=>navigate(view==='workspace'?'Workspace':view==='permissions'?'Permissions':'Actions')}/>}
      {page==='Routines'&&<section className="grid gap-3" aria-label="Routine draft"><p className="text-sm text-muted">Draft only. Scheduled execution is not available yet; saving does not send prompts.</p><Label htmlFor="routine-prompt">Recurring task</Label><Textarea id="routine-prompt" value={routinePrompt} maxLength={4000} placeholder="What should this bot check or prepare?" onChange={e=>setRoutinePrompt(e.target.value)}/><Input label="Daily time" type="time" value={routineTime} onChange={e=>setRoutineTime(e.target.value)} show={{label:true,hideRequireType:true}}/><Input label="Timezone" value={routineZone} maxLength={80} onChange={e=>setRoutineZone(e.target.value)} show={{label:true,hideRequireType:true}}/></section>}
    </div></Scrollbar>
    {error && <p role="alert">{error}</p>}{(page==='Settings'||page==='Routines')&&<div className="bot-dialog-actions"><Button variant="ghost" type="button" onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()} isLoading={busy}>Save settings</Button></div>}</fieldset>
  </form></aside></>
}
