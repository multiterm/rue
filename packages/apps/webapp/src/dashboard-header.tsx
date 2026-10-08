import {Button, RueLogo, SettingsIcon, ThemeControls, type ThemeControlsValue } from '@multiterm/rue-ui'

export function DashboardHeader({ menuOpen, toggleMenu, openSettings, appearance, changeAppearance }: {
  menuOpen: boolean; toggleMenu(): void; openSettings(): void
  appearance?: ThemeControlsValue; changeAppearance(value: ThemeControlsValue): void
}) {
  return <header className="dashboard-header" aria-label="Workspace header">
    <Button variant="bare" type="button" className="dashboard-icon dashboard-menu-toggle" aria-label={menuOpen ? 'Close bot menu' : 'Open bot menu'} aria-expanded={menuOpen} aria-controls="bot-navigation" onClick={toggleMenu}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
    </Button>
    <RueLogo className="dashboard-logo"/>
    <div className="dashboard-header-actions">
      <Button variant="bare" type="button" className="dashboard-icon" aria-label="Open settings" title="Settings" onClick={openSettings}><SettingsIcon size={18} aria-hidden="true"/></Button>
      <ThemeControls className="dashboard-theme" compact synced={appearance} onChange={changeAppearance}/>
    </div>
  </header>
}
