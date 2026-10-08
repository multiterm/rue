import { useState } from 'react'
import { useRemoteFreshness } from './use-remote-freshness'
import type { RueRemoteComputer } from '@multiterm/rue-sdk'
import { Button, CopyButton, Dialog, Scrollbar } from '@multiterm/rue-ui'
import { app } from './app'

export function RemoteConnectionControls({ computer, observedAt, checking, healthError = false, managed = false, refresh, manage }: { managed?: boolean; computer?: RueRemoteComputer; observedAt?: number; checking: boolean; healthError?: boolean; refresh(): void | Promise<unknown>; manage(): void }) {
  const [reconnect, setReconnect] = useState(false), [details, setDetails] = useState(false), [refreshing, setRefreshing] = useState(false)
  async function refreshNow() {
    setRefreshing(true)
    try { await refresh() } catch { /* Query state supplies the health error. */ }
    finally { setRefreshing(false) }
  }
  const fresh = useRemoteFreshness(computer, observedAt)
  // Reconnect follows confirmed server state, not a client timer or fetch failure.
  // Preserve the last confirmed action during failed background refreshes.
  const disconnected = ['offline','disconnected','revoked','expired'].includes(computer?.status ?? '')
  const stale = computer?.status === 'online' && !fresh
  const uploadRetry = Boolean(computer?.health?.uploadFailures)
  const state = healthError ? 'intermittent' : disconnected ? 'disconnected' : !healthError && computer?.status === 'online' && !stale && !uploadRetry ? 'connected' : 'intermittent'
  const label = healthError ? 'Health check failed' : disconnected ? `Disconnected (${computer?.status})` : uploadRetry ? 'Retrying output upload' : stale ? 'Heartbeat delayed' : !computer && checking ? 'Checking connection' : state === 'connected' ? 'Connected' : 'Connection health uncertain'
  const date = (value?: number | null) => value ? new Date(value).toLocaleTimeString() : 'Not reported'
  return <><span className="agent-connection-controls" role="region" aria-label="Remote connection">
    <Button variant="bare" type="button" className="connection-dot-button" aria-label={`Connection details: ${label}`} title={label} onClick={() => setDetails(true)}><span className="remote-status-dot" data-state={state} aria-hidden="true"/><span className="sr-only" role="status">{label}</span></Button>
    {disconnected && !managed && <Button size="sm" variant="secondary" onClick={() => setReconnect(true)}>Reconnect</Button>}
  </span>
  <Dialog open={details} onClose={() => setDetails(false)} title="Connection details" description="Last reported transport health. Cached values are not proof of a live connection.">
    <div className="connection-diagnostics"><p role="status">{label}</p><dl>
      <dt>Remote prompts</dt><dd>{healthError || !computer ? 'Unknown' : computer.remoteEnabled ? 'Enabled' : 'Disabled'}</dd>
      <dt>Last heartbeat</dt><dd>{date(computer?.lastSeenAt)}</dd>
      <dt>Lease expires</dt><dd>{date(computer?.leaseExpiresAt)}</dd>
      <dt>Transport</dt><dd>{computer?.health?.transport === 'websocket' ? 'WebSocket' : computer?.health?.transport === 'https' ? 'HTTPS polling (fallback)' : 'Not reported'}</dd>
      <dt>Relay protocol</dt><dd>{computer?.relayProtocol ?? 'Legacy / not reported'}</dd>
      <dt>Last output acknowledgement</dt><dd>{date(computer?.health?.lastUploadAt)}</dd>
      <dt>Pending uploads</dt><dd>{computer?.health ? `${computer.health.pendingCount} (${computer.health.pendingBytes} bytes)` : 'Not reported'}</dd>
      <dt>Retries / output failures</dt><dd>{computer?.health ? `${computer.health.retries} / ${computer.health.uploadFailures}` : 'Not reported'}</dd>
      <dt>Last poll latency</dt><dd>{computer?.health ? `${computer.health.pollLatencyMs} ms` : 'Not reported'}</dd>
    </dl></div>
  </Dialog>
  <Dialog open={reconnect} onClose={() => setReconnect(false)} title="Reconnect remote bot" description="Rue cannot start Pi on your computer from the browser. Reconnect explicitly; this bot will never switch to cloud execution.">
    <Scrollbar className="reconnect-steps"><ol><li>Open the same Pi session on the linked computer. Check <code>/rue status</code> first. Short network failures retry automatically within the current lease.</li><li>If stopped, run <code>/rue resume</code>.<CopyButton text="/rue resume" label="Copy resume command"/> Interrupted commands are never automatically replayed.</li><li>In this development checkout, use <code>/rue-dev resume</code> to skip URL prompts. For custom deployments, the API HTTPS origin is:<code className="block">{app.urls.api}</code><CopyButton text={app.urls.api} label="Copy API origin"/></li><li>If expired or revoked, run <code>/rue</code> and confirm replacing the saved link, then approve it in Agents using the same account. The existing bot/history is reused.</li><li>Enable remote prompts in settings. Trust and tool-text sharing default on unless disabled for this saved link. Use <code>/rue untrust</code> or <code>/rue hide-tools</code> to opt out.</li></ol><p>To use a different Pi session, pair it as a different bot. An existing bot cannot be silently reassigned.</p></Scrollbar>
    <div className="bot-dialog-actions"><Button variant="secondary" onClick={() => { setReconnect(false); manage() }}>Remote agent settings</Button><Button disabled={refreshing} onClick={() => void refreshNow()}>Check connection</Button></div>
    <p role="status">Connection: {label}</p>
  </Dialog></>
}
