import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Dialog, Scrollbar } from '@multiterm/rue-ui'
import { AgentSettingsPanel } from './agent-settings'
import {ApiKeysPanel} from './api-keys'
import { ManagedHostsPanel } from './managed-hosts'
import { RemoteComputersPanel } from './remote-computers'
import { McpPanel } from './mcp'
import { ProviderKeysPanel } from './provider-keys'
import { ConnectionStatus, SettingsHelp, settingsDocs } from './settings-support'
import { app } from './app'
import { rue } from './client'
import './settings.css'
import {NotificationSettings} from './notifications'

const pages = [
  { name: 'Notifications', group: 'Workspace', icon: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4' },
  { name: 'Appearance', group: 'Workspace', icon: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h3a6 6 0 0 0 0-10Z' },
  { name: 'Models', group: 'AI', icon: 'm12 3 9 5v8l-9 5-9-5V8Zm0 9 9-4M12 12 3 8m9 4v9' },
  { name: 'AI keys', group: 'AI', icon: 'M14 14a6 6 0 1 0-4-4L3 17v4h4v-3h3l4-4Zm3-7h.01' },
  { name: 'MCP', group: 'AI', icon: 'm7 8-4 4 4 4m10-8 4 4-4 4m-3-11-4 14' },
  { name: 'Agents', group: 'Connections', icon: 'M4 5h16v12H4Zm4 16h8m-4-4v4M8 9l3 3-3 2m6 0h3' },
  { name: 'Hosts', group: 'Connections', icon: 'M4 3h16v7H4Zm0 11h16v7H4ZM7 6h.01M7 17h.01' },
  { name: 'API keys', group: 'Connections', icon: 'M14 14a6 6 0 1 0-4-4L3 17v4h4v-3h3l4-4Zm3-7h.01' },
  { name: 'Server', group: 'Connections', icon: 'M12 3v4m0 10v4M3 12h4m10 0h4M8 8h8v8H8Z' },
  { name: 'Support', group: 'Help', icon: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0' },
] as const
export type SettingsCategory = typeof pages[number]['name']
const descriptions:Record<SettingsCategory,string>={Notifications:'Task-completion alerts on this device.',Appearance:'Choose your theme and accent palette.',Models:'Default models for cloud conversations.', 'AI keys':'Manage provider credentials and agent access.',MCP:'Tool connections for managed agents.',Agents:'Manage runtimes and linked Pi sessions.',Hosts:'Computers that run your managed agents.','API keys':'Manage Rue API access through Tenancy.',Server:'Connection and authentication details.',Support:'Documentation and help.'}
const slug = (name: string) => name.toLowerCase().replaceAll(' ', '-')
function ServerSettings({linkDevice}:{linkDevice?:()=>void}) {
  const health = useQuery({ queryKey: ['server-health'], queryFn: () => rue.health(), retry: false })
  return <div className="settings-stack"><div className="settings-card"><div className="settings-row"><strong>Rue API</strong><ConnectionStatus status={health.isPending ? 'checking' : health.data?.ok && !health.isError ? 'connected' : 'unavailable'}/></div><code className="settings-endpoint">{app.urls.api}</code><div className="settings-row"><span>Authentication</span><span>{health.data?.authentication === 'keyname' ? 'Keyname' : health.data?.authentication === 'password' ? 'Password' : health.data?.authentication === 'none' ? 'None' : 'Unknown'}</span></div>{health.data && <div className="settings-row"><span>Version</span><span>{health.data.version}</span></div>}<Button disabled={health.isFetching} onClick={() => void health.refetch()}>Check connection</Button></div>{linkDevice&&<Button variant="ghost" onClick={linkDevice}>Link device</Button>}<SettingsHelp section="server"/></div>
}
export function SettingsPanel({ owner, general, onClose, linkDevice,initialCategory = 'Appearance' }: { owner: string; general: ReactNode; onClose(): void; linkDevice?:()=>void;initialCategory?: SettingsCategory }) {
  const navigation = useRef<HTMLElement>(null)
  const [category, setCategory] = useState<SettingsCategory>(initialCategory)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = navigation.current?.closest<HTMLElement>('[role="dialog"]')
    const selected = navigation.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    selected?.focus({ preventScroll: true }); selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const trap = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || !dialog) return
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]')).filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    dialog?.addEventListener('keydown', trap)
    return () => { dialog?.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const [modelsVisited, setModelsVisited] = useState(initialCategory === 'Models')
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width:640px)').matches)
  useEffect(() => { const media = window.matchMedia('(max-width:640px)'), changed = () => setCompact(media.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed) }, [])
  function select(value: SettingsCategory) { setCategory(value); if (value === 'Models') setModelsVisited(true) }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const index = pages.findIndex(page => page.name === category)
    const next = event.key === (compact ? 'ArrowRight' : 'ArrowDown') ? (index + 1) % pages.length : event.key === (compact ? 'ArrowLeft' : 'ArrowUp') ? (index + pages.length - 1) % pages.length : event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : undefined
    if (next === undefined) return
    event.preventDefault(); select(pages[next]!.name)
    const tab = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
    tab?.focus(); tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  return <Dialog open onClose={onClose} title="Settings" className="rue-settings-dialog">
    <div className="rue-settings-layout">
      <nav ref={navigation} className="settings-navigation" aria-label="Settings navigation"><div role="tablist" aria-label="Settings categories" aria-orientation={compact ? 'horizontal' : 'vertical'} className="rue-settings-sidebar" onKeyDown={navigate}>
        {pages.map((page, index) => <div key={page.name} className="settings-nav-item">{(index === 0 || pages[index - 1]!.group !== page.group) && <span className="settings-nav-group" aria-hidden="true">{page.group}</span>}<Button variant="bare" type="button" role="tab" id={`settings-tab-${slug(page.name)}`} aria-controls={`settings-page-${slug(page.name)}`} aria-selected={category === page.name} tabIndex={category === page.name ? 0 : -1} onClick={() => select(page.name)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={page.icon}/></svg>{page.name}</Button></div>)}
      </div></nav>
      <div className="rue-settings-page-frame"><Scrollbar className="settings-page-scroll" viewportClassName="rue-settings-content">
        {pages.map(({ name }) => <section key={name} role="tabpanel" id={`settings-page-${slug(name)}`} aria-labelledby={`settings-tab-${slug(name)}`} hidden={category !== name} tabIndex={0}>
          <header className="settings-page-heading"><h3>{name}</h3><p>{descriptions[name]}</p></header>
          {name === 'Appearance' && general}
          {name === 'Notifications' && category === name && <NotificationSettings owner={owner}/>}
          {name === 'Models' && modelsVisited && <AgentSettingsPanel owner={owner} onClose={onClose}/>}
          {name === 'AI keys' && category === name && <ProviderKeysPanel key={owner} owner={owner}/>}
          {name === 'Agents' && category === name && <RemoteComputersPanel key={owner} owner={owner}/>}
          {name === 'Hosts' && category === name && <ManagedHostsPanel key={owner} owner={owner}/>}
          {name === 'API keys' && category === name && <ApiKeysPanel key={owner} owner={owner}/>}
          {name === 'Server' && category === name && <ServerSettings linkDevice={linkDevice}/>}
          {name === 'MCP' && category === name && <McpPanel key={owner} owner={owner}/>}
          {name === 'Support' && <div className="settings-stack"><a className="settings-link-card" href={settingsDocs()} target="_blank" rel="noreferrer"><strong>Documentation ↗</strong><span>Setup, connections, keys, and troubleshooting</span></a><a className="settings-link-card" href={`${app.urls.github}/issues`} target="_blank" rel="noreferrer"><strong>Report an issue ↗</strong><span>Get help with a bug or request a feature</span></a></div>}
        </section>)}
      </Scrollbar></div>
    </div>
  </Dialog>
}
