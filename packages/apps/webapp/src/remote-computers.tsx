import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input } from '@multiterm/rue-ui'
import type { RueRemoteComputer } from '@multiterm/rue-sdk'
import { rue } from './client'

export function ComputerApproval({ owner, initialRequest = '' }: { owner: string; initialRequest?: string }) {
  const [request, setRequest] = useState(initialRequest), [name, setName] = useState('My computer'), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function approve() {
    setBusy(true); setError(''); setCode('')
    try {
      const result = await rue.approveTerminalPairing(request.trim(), { expectedOwnerSubject: owner, botName: name.trim() })
      if (result.ownerSubject !== owner) throw Error('identity')
      setCode(result.code)
    } catch { setError('Could not approve. Check your account and start a new request on the computer.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-3">
    <h4>Link a computer</h4>
    <p>Account subject: <code>{owner}</code></p>
    <p>Run Pi with Rue’s reviewed extension on that computer, then run <code>/rue</code>. No inbound port, SSH password, or provider key is needed here.</p>
    <p>Approve only a request you just started. New user and assistant text will sync to this account; prior history, tool results, and credentials are not uploaded.</p>
    <Input label="Computer request ID" value={request} maxLength={32} onChange={e => setRequest(e.target.value)} show={{ label: true, hideRequireType: true }}/>
    <Input label="Computer name" value={name} maxLength={60} onChange={e => setName(e.target.value)} show={{ label: true, hideRequireType: true }}/>
    <Button onClick={() => void approve()} disabled={busy || Boolean(code) || !/^[A-Za-z0-9_-]{32}$/.test(request.trim()) || !name.trim()}>Approve computer</Button>
    {code && <div role="status"><p>Paste this one-time code into Pi’s local prompt, then confirm your account there. Never put it in a chat message.</p><code aria-label="Computer pairing code">{code}</code><p>Remote prompting is off initially. Enable it below after connection.</p></div>}
    {error && <p role="alert">{error}</p>}
  </section>
}
function Computer({ computer, owner, botName, changed }: { computer: RueRemoteComputer; owner: string; botName?: string; changed(): void }) {
  const [name, setName] = useState(computer.name), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function update(revoke = false, enabled = computer.remoteEnabled) {
    setBusy(true); setError('')
    try {
      if (revoke) await rue.revokeTerminalConnection(computer.id)
      else await rue.configureComputer(computer.id, { expectedOwnerSubject: owner, name: name.trim(), remoteEnabled: enabled, expectedRevision: computer.revision })
      changed()
    } catch { setError('Computer changed or account is unavailable. Refresh before retrying.') }
    finally { setBusy(false) }
  }
  const disconnected = ['expired', 'revoked'].includes(computer.status)
  return <article className="space-y-3 border rounded p-3">
    <Input label="Name" value={name} onChange={e => setName(e.target.value)} maxLength={60} disabled={disconnected} show={{ label: true, hideRequireType: true }}/>
    <p>Linked bot: <strong>{botName ?? 'Loading bot…'}</strong> · <code>{computer.sessionId}</code>. One bot per remote Pi session.</p>
    <p>Status: {computer.status}. Remote prompts: {computer.remoteEnabled ? 'enabled, approval policy controlled in Pi' : 'disabled'}.</p>
    <p>Expires {new Date(computer.expiresAt).toLocaleString()}. Provider and model are selected in Pi on the computer.</p>
    <Button disabled={busy || disconnected || !name.trim()} onClick={() => void update()}>Save computer name</Button>{' '}
    <Button disabled={busy || disconnected || !name.trim()} onClick={() => void update(false, !computer.remoteEnabled)}>{computer.remoteEnabled ? 'Disable remote prompts' : 'Enable remote prompts'}</Button>{' '}
    <Button disabled={busy || disconnected} variant="destructive" onClick={() => { if (window.confirm('Revoke this computer? It will need to pair again.')) void update(true) }}>Revoke computer</Button>
    {computer.runs.length > 0 && <ul aria-label="Recent remote runs">{computer.runs.map(run => <li key={run.id}>{run.status} · {new Date(run.created_at).toLocaleTimeString()}</li>)}</ul>}
    {error && <p role="alert">{error}</p>}
  </article>
}
export function RemoteComputersPanel({ owner }: { owner: string }) {
  const cache = useQueryClient()
  const computers = useQuery({ queryKey: ['remote-computers', owner], queryFn: () => rue.remoteComputers(), retry: false, refetchInterval: 5000 })
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => rue.sessions(), retry: false })
  const valid = computers.data?.computers.every(c => c.ownerSubject === owner)
  return <div className="space-y-6">
    <p>Cloud bots run on Rue’s server; paired bots run in one specific Pi session. Credentials stay on that computer, and a remote bot never falls back to cloud execution.</p>
    <p>Pi asks per prompt by default. Run <code>/rue trust</code> locally to approve this connection for the current session, or <code>/rue untrust</code> to restore per-prompt approval. Existing tool permissions still apply; trust is not saved across reconnects or restarts.</p>
    <ComputerApproval key={owner} owner={owner}/>
    <h4>Paired computers</h4>
    {computers.isPending ? <p role="status">Loading computers…</p> : !valid ? <p role="alert">Remote computers are unavailable in this environment or account.</p> : computers.data!.computers.map(c => <Computer key={c.id} computer={c} owner={owner} botName={sessions.data?.find(s => s.id === c.sessionId && s.ownerSubject === owner)?.title} changed={() => { void cache.invalidateQueries({ queryKey: ['remote-computers', owner] }); void cache.invalidateQueries({ queryKey: ['sessions'] }) }}/>) }
    {valid && !computers.data!.computers.length && <p>No computers paired yet.</p>}
  </div>
}
