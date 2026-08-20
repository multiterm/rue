export const rueThemes = ['Grove', 'Midnight', 'Paper', 'Mono'] as const
export const rueModes = ['light', 'dark'] as const
export type RueTheme = (typeof rueThemes)[number]
export type RueMode = (typeof rueModes)[number]
export interface RuePalette { background: string; surface: string; text: string; muted: string; primary: string; accent: string }
export const rueNativeThemes: Record<RueMode, RuePalette> = {
  dark: { background:'#07100b', surface:'#102219', text:'#f4fff7', muted:'#a0b9a8', primary:'#8df0b2', accent:'#5eead4' },
  light: { background:'#f4f8f3', surface:'#ffffff', text:'#0b2415', muted:'#4f6858', primary:'#176c3a', accent:'#087f72' },
}
export function applyRueTheme(theme: RueTheme, mode: RueMode) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.mode = mode
  localStorage.setItem('rue.theme', theme)
  localStorage.setItem('rue.mode', mode)
}
export function readRueTheme(): { theme: RueTheme; mode: RueMode } {
  if (typeof localStorage === 'undefined') return { theme:'Grove', mode:'dark' }
  const theme = localStorage.getItem('rue.theme') as RueTheme
  const mode = localStorage.getItem('rue.mode') as RueMode
  return { theme: rueThemes.includes(theme) ? theme : 'Grove', mode: rueModes.includes(mode) ? mode : 'dark' }
}
