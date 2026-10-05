import { Button } from '../button/index.js'
import { useEffect, useState, type ReactNode } from 'react'
import {Tabs,TabsList,TabsTrigger} from '../tabs/index.js'
import { Sun, Moon } from 'lucide-react'
import { applyRueTheme, readRueTheme, rueModes, rueThemes, rueNativeThemePalettes, type RueMode, type RueTheme } from '@multiterm/rue-gds'
export function ThemeProvider({children}:{children:ReactNode}){const [initial]=useState(readRueTheme);useEffect(()=>applyRueTheme(initial.theme,initial.mode),[initial]);return children}
export interface ThemeControlsValue{theme:RueTheme;mode:RueMode|'system'}
export function ThemeControls({className='',compact=false,settings=false,synced,onChange}:{className?:string;compact?:boolean;settings?:boolean;synced?:ThemeControlsValue;onChange?:(value:ThemeControlsValue)=>void}) {
  const [value,setValue]=useState(readRueTheme)
  useEffect(()=>{if(!synced||!rueThemes.includes(synced.theme)||(synced.mode!=='system'&&!rueModes.includes(synced.mode)))return;setValue(synced);applyRueTheme(synced.theme,synced.mode)},[synced])
  const update=(next:ThemeControlsValue)=>{setValue(next);applyRueTheme(next.theme,next.mode);onChange?.(next)}
  const [systemDark,setSystemDark]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)'),changed=()=>setSystemDark(media.matches);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed)},[])
  const resolved=value.mode==='system'?(systemDark?'dark':'light'):value.mode,nextMode=resolved==='dark'?'light':'dark'
  if(settings)return <div className={`grid gap-7 ${className}`}><section className="grid gap-3" aria-label="Theme mode"><h4>Theme</h4><Tabs value={value.mode} onValueChange={mode=>update({...value,mode:mode as ThemeControlsValue['mode']})}><TabsList aria-label="Theme mode">{(['light','dark','system'] as const).map(mode=><TabsTrigger key={mode} value={mode}>{mode[0]!.toUpperCase()+mode.slice(1)}</TabsTrigger>)}</TabsList></Tabs></section><section className="grid gap-3" aria-label="Accent palette"><h4>Accent palette</h4><div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="group" aria-label="Palettes">{rueThemes.map(theme=>{const colors=rueNativeThemePalettes[theme][resolved];return <Button key={theme} type="button" variant="outline" aria-pressed={value.theme===theme} aria-label={`${theme} palette`} className="h-auto flex-col items-stretch gap-3 p-3 aria-pressed:border-control" onClick={()=>update({...value,theme})}><span className="flex gap-1" aria-hidden>{[colors.primary,colors.accent,colors.surface].map((color,i)=><span key={i} className="h-6 flex-1 rounded border border-border" style={{background:color}}/>)}</span><span>{theme}</span></Button>})}</div></section></div>
  return <div className={`flex items-center gap-2 ${className}`}>
    {!compact&&<select aria-label="Theme" value={value.theme} onChange={e=>update({...value,theme:e.target.value as RueTheme})} className="h-9 rounded-md border border-border bg-surface px-2 text-xs text-foreground">{rueThemes.map(theme=><option key={theme}>{theme}</option>)}</select>}
    <Button variant="bare" type="button" aria-label={compact?`Switch to ${nextMode} mode`:undefined} title={compact?`Switch to ${nextMode} mode`:undefined} onClick={()=>update({...value,mode:nextMode})} className={compact?'grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-muted hover:text-foreground':'h-9 rounded-md border border-border bg-surface px-3 text-xs font-semibold text-muted hover:text-foreground'}>{compact?(resolved==='dark'?<Moon size={18} aria-hidden="true"/>:<Sun size={18} aria-hidden="true"/>):nextMode==='light'?'Light':'Dark'}</Button>
  </div>
}
export { rueThemes, rueModes }
