import { useContext, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input,DataTable,Dialog,TableIcon } from '@multiterm/rue-ui'
import type { RueRemoteComputer } from '@multiterm/rue-sdk'
import { rue } from './client'
import { LoadingSkeleton } from './loading-skeleton'
import { LiveSyncContext } from './live-sync'
import { ConnectionStatus, SettingsHelp, SettingsRefresh, SettingsAdd } from './settings-support'
import { ManagedAgentsPanel } from './managed-agents'
import { useRemoteFreshness } from './use-remote-freshness'

export function ComputerApproval({ owner, initialRequest = '' }: { owner: string; initialRequest?: string }) {
  const [request, setRequest] = useState(initialRequest), [name, setName] = useState('My agent'), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function approve() {
    setBusy(true); setError(''); setCode('')
    try {
      const result = await rue.approveTerminalPairing(request.trim(), { expectedOwnerSubject: owner, botName: name.trim() })
      if (result.ownerSubject !== owner) throw Error('identity')
      setCode(result.code)
    } catch { setError('Could not link. Start a new pairing request in Pi.') }
    finally { setBusy(false) }
  }
  return <section className="settings-card">
    <h4>Link a remote agent</h4><p>Run <code>/rue</code> in Pi, then paste its request ID.</p>
    <p>Linking trusts remote prompts and shares tool text, which may contain private files or secrets. Thinking remains opt-in.</p>
    <p>Account</p><code className="block">{owner}</code>
    <Input label="Pairing request" value={request} maxLength={32} onChange={e => setRequest(e.target.value)} show={{ label: true, hideRequireType: true }}/>
    <Input label="Agent name" value={name} maxLength={60} onChange={e => setName(e.target.value)} show={{ label: true, hideRequireType: true }}/>
    <Button onClick={() => void approve()} disabled={busy || Boolean(code) || !/^[A-Za-z0-9_-]{32}$/.test(request.trim()) || !name.trim()}>Link agent</Button>
    {code && <div role="status"><p>Paste only into Pi’s pairing prompt, then confirm your account.</p><code className="block" aria-label="Agent pairing code">{code}</code><p>Enable remote prompts after linking.</p></div>}
    <SettingsHelp section="remote-agents"/>
    {error && <p role="alert">{error}</p>}
  </section>
}
function AgentConnection({computer,observedAt,uncertain}:{computer:RueRemoteComputer;observedAt:number;uncertain:boolean}){const fresh=useRemoteFreshness(computer,observedAt);return <ConnectionStatus status={computer.status==='online'&&(uncertain||!fresh)?'checking':computer.status}/>}
function Agent({ computer, owner, botName, observedAt, uncertain, changed }: { computer: RueRemoteComputer; owner: string; botName?: string; observedAt: number; uncertain: boolean; changed(): void }) {
  const [name, setName] = useState(computer.name), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const fresh = useRemoteFreshness(computer, observedAt)
  async function update(revoke = false, enabled = computer.remoteEnabled) {
    setBusy(true); setError('')
    try {
      if (revoke) await rue.revokeTerminalConnection(computer.id)
      else await rue.configureComputer(computer.id, { expectedOwnerSubject: owner, name: name.trim(), remoteEnabled: enabled, expectedRevision: computer.revision })
      changed()
    } catch { setError('Agent changed. Refresh and retry.') }
    finally { setBusy(false) }
  }
  const unavailable = ['expired', 'revoked'].includes(computer.status)
  return <article className="settings-card" aria-label={`Remote agent ${botName ?? computer.name}`}>
    <div className="settings-item-heading"><div><h4>{botName ?? computer.name}</h4><small>Pi · {computer.name}</small></div><ConnectionStatus status={computer.status === 'online' && (uncertain || !fresh) ? 'checking' : computer.status}/></div>
    <div className="settings-stack">
      <Input label="Agent display name" value={name} onChange={e => setName(e.target.value)} maxLength={60} disabled={unavailable} show={{ label: true, hideRequireType: true }}/>
      <div className="settings-actions"><Button disabled={busy || unavailable || !name.trim()} onClick={() => void update()}>Save name</Button><Button disabled={busy || unavailable || !name.trim()} onClick={() => void update(false, !computer.remoteEnabled)}>{computer.remoteEnabled ? 'Disable remote prompts' : 'Enable remote prompts'}</Button><Button variant="ghost" disabled={busy || unavailable} onClick={() => { if (window.confirm('Revoke this agent? Pairing will be required again.')) void update(true) }}>Revoke agent</Button></div>
      <p>Expires {new Date(computer.expiresAt).toLocaleDateString()}</p>
    </div>
    {error && <p role="alert">{error}</p>}
  </article>
}
export function RemoteComputersPanel({ owner }: { owner: string }) {
  const cache = useQueryClient(), live = useContext(LiveSyncContext), [pairing, setPairing] = useState(false),[managing,setManaging]=useState<string>()
  const computers = useQuery({ queryKey: ['remote-computers', owner], queryFn: () => rue.remoteComputers(), retry: false, refetchInterval: live ? false : 5000 })
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => rue.sessions(), retry: false })
  const valid = computers.data?.computers.every(c => c.ownerSubject === owner)
  const linked=valid?computers.data!.computers.filter(c=>!c.managedAgentId):[]
  const botName=(computer:RueRemoteComputer)=>sessions.data?.find(s=>s.id===computer.sessionId&&s.ownerSubject===owner)?.title||computer.name
  const active=linked.find(c=>c.id===managing)
  return <div className="settings-stack">
    <ManagedAgentsPanel owner={owner}/>
    {pairing && <Dialog open title="Link agent" onClose={()=>setPairing(false)} className="max-h-[calc(100dvh-40px)] overflow-y-auto"><ComputerApproval key={owner} owner={owner}/></Dialog>}
    {computers.isPending ? <LoadingSkeleton label="Loading linked agents" kind="list"/> : !valid ? <p role="alert">Linked agents unavailable. <Button variant="bare" onClick={() => void computers.refetch()}>Retry</Button></p> : <DataTable title="Linked agents" rows={linked} rowKey={c=>c.id} empty="No linked agents. Link a Pi session to get started." actions={<><SettingsRefresh label="Refresh linked agents" disabled={computers.isFetching} onClick={()=>void computers.refetch()}/><SettingsAdd label="linked agent" onClick={()=>setPairing(true)}/></>} columns={[
      {id:'name',title:'Agent',value:botName},
      {id:'computer',title:'Computer',value:c=>c.name},
      {id:'status',title:'Connection',value:c=>c.status,render:c=><AgentConnection computer={c} observedAt={computers.dataUpdatedAt} uncertain={computers.isError}/>},
      {id:'prompts',title:'Remote prompts',value:c=>c.remoteEnabled?'Enabled':'Disabled',filterOptions:['Enabled','Disabled'].map(value=>({value,label:value}))},
      {id:'actions',title:'Actions',value:()=>'',sortable:false,render:c=><Button variant="ghost" size="icon" aria-label={`Manage ${botName(c)}`} title="Manage agent" onClick={()=>setManaging(c.id)}><TableIcon kind="access"/></Button>}
    ]}/>}
    {active&&<Dialog open title={`Manage ${botName(active)}`} onClose={()=>setManaging(undefined)} className="max-h-[calc(100dvh-40px)] overflow-y-auto"><Agent key={active.id} computer={active} owner={owner} observedAt={computers.dataUpdatedAt} uncertain={computers.isError} botName={botName(active)} changed={()=>{void cache.invalidateQueries({queryKey:['remote-computers',owner]});void cache.invalidateQueries({queryKey:['sessions']})}}/></Dialog>}
    {computers.isError && valid && <p role="status">Showing last-known agents. <Button variant="bare" onClick={() => void computers.refetch()}>Retry</Button></p>}
    <SettingsHelp section="remote-agents"/>
  </div>
}
