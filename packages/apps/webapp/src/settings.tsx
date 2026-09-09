import { useState, type ReactNode, type KeyboardEvent } from 'react'
import { Button, Dialog } from '@multiterm/rue-ui'
import { AgentSettingsPanel } from './agent-settings'
import './settings.css'

const categories = ['General', 'Agent', 'Security', 'Developer'] as const
type Category = typeof categories[number]

export function SettingsPanel({ owner, general, onClose }: { owner: string; general: ReactNode; onClose(): void }) {
  const [category, setCategory] = useState<Category>('General')
  const [agentVisited, setAgentVisited] = useState(false)
  function select(value: Category) {
    setCategory(value)
    if (value === 'Agent') setAgentVisited(true)
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const index = categories.indexOf(category)
    const next = event.key === 'ArrowDown' ? (index + 1) % categories.length : event.key === 'ArrowUp' ? (index + categories.length - 1) % categories.length : event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : undefined
    if (next === undefined) return
    event.preventDefault()
    select(categories[next]!)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return <Dialog open onClose={onClose} title="Settings" className="rue-settings-dialog">
    <div className="rue-settings-layout">
      <div role="tablist" aria-label="Settings categories" aria-orientation="vertical" className="rue-settings-sidebar" onKeyDown={navigate}>
        {categories.map(value => <Button key={value} type="button" role="tab" id={`settings-tab-${value}`} aria-controls={`settings-page-${value}`} aria-selected={category === value} tabIndex={category === value ? 0 : -1} variant={category === value ? 'secondary' : 'ghost'} onClick={() => select(value)}>{value}</Button>)}
      </div>
      <div className="rue-settings-content">
        {categories.map(value => <section key={value} role="tabpanel" id={`settings-page-${value}`} aria-labelledby={`settings-tab-${value}`} hidden={category !== value} tabIndex={0}>
          <h3 className="mb-4 mt-0 text-lg font-semibold">{value}</h3>
          {value === 'General' && <><p className="mb-5 text-sm text-muted">Customize Rue’s appearance across your devices.</p>{general}</>}
          {value === 'Agent' && agentVisited && <AgentSettingsPanel owner={owner} onClose={onClose}/>}
          {value === 'Security' && <div className="space-y-4 text-sm"><p>Sign-in is managed by Keyname. Rue does not store your account password.</p><p>Provider API keys are encrypted on the server and never returned to clients. Replace or remove your saved key on the Agent page.</p><p>Password and multi-factor authentication controls are not available in this settings modal yet.</p></div>}
          {value === 'Developer' && <div className="space-y-4 text-sm"><p>Rue currently uses Pi for text chat. Shell access, file tools, extensions, deployment execution, and self-updates are disabled.</p><p>Developer configuration controls are not available yet. Changing Agent settings does not grant tool permissions.</p></div>}
        </section>)}
      </div>
    </div>
  </Dialog>
}
