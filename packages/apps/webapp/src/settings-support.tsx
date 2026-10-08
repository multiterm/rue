import { app } from './app'
import {Button,MenuRefreshIcon,MenuPlusIcon} from '@multiterm/rue-ui'
export function SettingsRefresh({label,disabled,onClick}:{label:string;disabled?:boolean;onClick():void}){return <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} disabled={disabled} onClick={onClick}><MenuRefreshIcon size={16} colorMode="stripped" className="size-4 fill-none stroke-current stroke-2" aria-hidden/></Button>}
export function SettingsAdd({label,disabled,onClick}:{label:string;disabled?:boolean;onClick():void}){return <Button type="button" aria-label={`Add new ${label}`} title={`Add new ${label}`} disabled={disabled} onClick={onClick}><MenuPlusIcon size={16} colorMode="stripped" className="size-4 fill-none stroke-current stroke-2" aria-hidden/>Add new</Button>}
export const settingsDocs = (section = '') => new URL(`/settings${section ? `#${section}` : ''}`, app.urls.docs).href
export function SettingsHelp({ section = '' }: { section?: string }) {
  return <a className="settings-help" href={settingsDocs(section)} target="_blank" rel="noreferrer">Help & documentation ↗</a>
}
export function ConnectionStatus({ status }: { status: string }) {
  const connected = ['online','connected'].includes(status)
  return <span className="settings-status" data-state={connected ? 'online' : status === 'revoked' ? 'revoked' : 'offline'}><i aria-hidden="true"/>{connected ? 'Connected' : status === 'unconfirmed' ? 'Not connected' : status.replace(/^./, c => c.toUpperCase())}</span>
}
