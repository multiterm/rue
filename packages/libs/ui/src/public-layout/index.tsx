import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, ButtonLink } from '../button/index.js'
import { ThemeControls } from '../theme/index.js'
import './public-layout.css'

/** Shared public chrome, following Keyname's framed, responsive public layout. */
export function PublicLayout({ children, homeHref, docsHref, loginHref, supportHref, wide = false, status }: {
  children: ReactNode; homeHref: string; docsHref: string; loginHref: string; supportHref: string; wide?: boolean; status?: ReactNode
}) {
  const [open, setOpen] = useState(false), toggle = useRef<HTMLButtonElement>(null)
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width:880px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width:880px)'), update = () => { setCompact(media.matches); setOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); toggle.current?.focus() } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])
  return <div className="rue-public"><div className={`rue-public-frame${wide ? ' rue-public-wide' : ''}`}>
    <header className="rue-public-header">
      <a className="rue-public-brand" href={homeHref}>Rue</a>
      <nav className="rue-public-desktop" aria-label="Main navigation"><a href={homeHref}>Home</a><a href={docsHref}>Docs</a><a href={supportHref}>Support</a></nav>
      <div className="rue-public-desktop rue-public-tools">{status}{!compact && <ThemeControls/>}<ButtonLink variant="ghost" href={loginHref}>Open Rue</ButtonLink></div>
      <Button ref={toggle} variant="bare" className="rue-public-menu-toggle" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="public-mobile-menu" onClick={() => setOpen(!open)}>{open ? '×' : '☰'}</Button>
      {open && compact && <nav id="public-mobile-menu" className="rue-public-mobile" aria-label="Mobile navigation" onClick={event => { if ((event.target as HTMLElement).closest('a')) setOpen(false) }}><a href={homeHref}>Home</a><a href={docsHref}>Docs</a><a href={supportHref}>Support</a><div className="rue-public-mobile-tools"><ThemeControls/><ButtonLink href={loginHref}>Open Rue</ButtonLink></div></nav>}
    </header>
    <div className="rue-public-body">{children}</div>
    <footer className="rue-public-footer"><div><a className="rue-public-brand" href={homeHref}>Rue</a><p>Your agents, across every device.</p><small>TERMINAL · WEB · MOBILE · DESKTOP</small></div><nav aria-label="Resources"><strong>Resources</strong><a href={docsHref}>Documentation</a><a href={supportHref}>Support</a><a href={loginHref}>Sign in →</a></nav></footer>
  </div></div>
}
