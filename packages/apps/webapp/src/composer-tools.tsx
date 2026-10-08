import { useEffect, useId, useRef, useState } from 'react'
import './composer-tools.css'
import {Button, Input, InfoIcon, PlusIcon, Scrollbar } from '@multiterm/rue-ui'

const commands = [
  ['/help', 'Show these commands'],
  ['/new', 'Create a cloud bot'],
  ['/settings', 'Current bot’s name, group, labels and colors'],
  ['/remote', 'Manage paired computers and reconnect'],
  ['/rename NAME', 'Rename current bot'],
  ['/group NAME', 'Group current bot; omit name to ungroup'],
  ['/label tag, other', 'Set labels; omit tags to remove them'],
]

const iconPaths = {
  attach: 'M21 11.5 12 20.5a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 0 1-2.8-2.8l9.2-9.2',
  screenshot: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h10v10H7z',
  create: 'M12 5v14M5 12h14',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  remote: 'M3 3h18v14H3zM8 21h8m-4-4v4',
}
function ActionIcon({ name }: { name: keyof typeof iconPaths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]}/></svg>
}

export function ComposerTools({ helpOpen, setHelpOpen, create, settings, remote, hasBot, attach, screenshot, attachmentDisabled }: {
  helpOpen: boolean; setHelpOpen(value: boolean): void
  create(): void; settings(): void; remote(): void; hasBot: boolean
  attach(): void; screenshot(): void; attachmentDisabled: boolean
}) {
  const [search, setSearch] = useState('')
  const id = useId(), plus = useRef<HTMLButtonElement>(null), info = useRef<HTMLButtonElement>(null)
  const actions = useRef<HTMLDivElement>(null), help = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (helpOpen) help.current?.showPopover()
    else help.current?.hidePopover()
  }, [helpOpen])
  useEffect(() => {
    const position = () => {
      for (const [trigger, panel] of [[plus.current, actions.current], [info.current, help.current]]) {
        if (!trigger || !panel || !panel.matches(':popover-open')) continue
        const rect = trigger.getBoundingClientRect()
        const composer = trigger.closest('.composer')?.getBoundingClientRect()
        const viewport = window.visualViewport
        const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
        const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
        if (panel === actions.current) panel.style.width = `${Math.min(760, composer?.width ?? 600, width - 24)}px`
        panel.style.maxWidth = `${Math.max(0, width - 24)}px`
        panel.style.maxHeight = `${Math.max(0, height - 24)}px`
        const anchor = panel === actions.current && composer ? composer : rect
        const above = anchor.top - panel.offsetHeight - 8
        const below = anchor.bottom + 8
        panel.style.left = `${Math.max(left + 12, Math.min(anchor.left, left + width - panel.offsetWidth - 12))}px`
        panel.style.top = `${Math.max(top + 12, above >= top + 12 || below + panel.offsetHeight > top + height - 12 ? above : below)}px`
      }
    }
    const panels = [actions.current, help.current]
    for (const panel of panels) panel?.addEventListener('toggle', position)
    let frame = 0
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position) })
    panels.forEach(panel => { if (panel) observer.observe(panel) })
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      panels.forEach(panel => panel?.removeEventListener('toggle', position))
      observer.disconnect(); cancelAnimationFrame(frame)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [])
  const run = (action: () => void) => { actions.current?.hidePopover(); action() }
  const items = [
    { icon: 'attach' as const, label: 'Add photos & files', description: 'Upload photos, videos or files from your device', action: attach, disabled: attachmentDisabled },
    { icon: 'screenshot' as const, label: 'Take screenshot', description: typeof navigator.mediaDevices?.getDisplayMedia==='function'?'Capture a screen frame into your draft':'Choose a saved screenshot from your device', action: screenshot, disabled: attachmentDisabled },
    { icon: 'create' as const, label: 'New bot', description: 'Start a new cloud conversation', action: create },
    { icon: 'settings' as const, label: 'Settings', description: 'Customize name, group, labels and colors', action: settings, disabled: !hasBot },
    { icon: 'remote' as const, label: 'Agents', description: 'Manage remote and linked Pi agents', action: remote },
  ].filter(item => `${item.label} ${item.description}`.toLowerCase().includes(search.toLowerCase().trim()))
  return <div className="composer-tools">
    <Button variant="bare" ref={plus} type="button" aria-label="Chat actions" title="Chat actions" popoverTarget={`${id}-actions`}><PlusIcon size={18}/></Button>
    <Button variant="bare" type="button" aria-label="Add attachment" title="Add attachment" disabled={attachmentDisabled} onClick={attach}><ActionIcon name="attach"/></Button>
    <Button variant="bare" ref={info} type="button" aria-label="Rue commands" title="Rue commands" popoverTarget={`${id}-help`}><InfoIcon size={18}/></Button>
    <div ref={actions} id={`${id}-actions`} popover="auto" role="region" aria-label="Chat actions" className="composer-popover composer-actions" onToggle={event => { if (event.newState === 'closed') setSearch('') }}>
      <div className="composer-action-list">
        {items.map(item => <Button variant="bare" key={item.icon} type="button" aria-label={item.label} disabled={item.disabled} onClick={() => run(item.action)}>
          <ActionIcon name={item.icon}/><span className="composer-action-label">{item.label}</span><span className="composer-action-description">{item.description}</span>
        </Button>)}
        {!items.length && <p role="status">No matching actions</p>}
      </div>
      <Input className="composer-action-search" aria-label="Search chat actions" placeholder="Search actions" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }}/>
      <small>Or paste / drop files · 10 MB each, 20 MB total</small>
    </div>
    <div ref={help} id={`${id}-help`} popover="auto" role="region" aria-label="Rue commands" className="composer-popover" onToggle={event => setHelpOpen(event.newState === 'open')}>
      <h2>Rue commands</h2>
      <p>Management commands run in Rue, not in your agent. Start with <code>//</code> to send a literal slash to the agent.</p>
      <Scrollbar className="command-list"><dl>{commands.map(([command, description]) => <div key={command}><dt><code>{command}</code></dt><dd>{description}</dd></div>)}</dl></Scrollbar>
    </div>
  </div>
}
