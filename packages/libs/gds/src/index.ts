export const rueThemes = ['Rue', 'Grove', 'Midnight', 'Paper', 'Mono', 'Sunset', 'Ocean'] as const
export const rueModes = ['light', 'dark'] as const
export type RueTheme = (typeof rueThemes)[number]
export type RueMode = (typeof rueModes)[number]
export interface RuePalette { background:string; surface:string; text:string; muted:string; primary:string; accent:string }

export const rueNativeThemePalettes: Record<RueTheme,Record<RueMode,RuePalette>> = {
  Rue: {
    light:{background:'#ffffff',surface:'#f7f7f5',text:'#111111',muted:'#777777',primary:'#111111',accent:'#54c987'},
    dark:{background:'#111111',surface:'#1b1b1a',text:'#f7f7f5',muted:'#a3a3a0',primary:'#f7f7f5',accent:'#64d99a'},
  },
  Grove: {
    light:{background:'#f4f8f3',surface:'#ffffff',text:'#0b2415',muted:'#4f6858',primary:'#176c3a',accent:'#087f72'},
    dark:{background:'#07100b',surface:'#102219',text:'#f4fff7',muted:'#a0b9a8',primary:'#8df0b2',accent:'#5eead4'},
  },
  Midnight: {
    light:{background:'#f5f7ff',surface:'#ffffff',text:'#101936',muted:'#53607e',primary:'#2563eb',accent:'#0891b2'},
    dark:{background:'#050713',surface:'#111831',text:'#f5f7ff',muted:'#9ba8cc',primary:'#60a5fa',accent:'#67e8f9'},
  },
  Paper: {
    light:{background:'#fbfaf7',surface:'#fffdf8',text:'#17120b',muted:'#675f53',primary:'#17120b',accent:'#059669'},
    dark:{background:'#14120f',surface:'#211d17',text:'#f5f0e7',muted:'#b7aa98',primary:'#f5f0e7',accent:'#10b981'},
  },
  Mono: {
    light:{background:'#f7f7f7',surface:'#ffffff',text:'#111111',muted:'#525252',primary:'#171717',accent:'#525252'},
    dark:{background:'#050505',surface:'#101010',text:'#fafafa',muted:'#a3a3a3',primary:'#f5f5f5',accent:'#d4d4d4'},
  },
  Sunset: {
    light:{background:'#fff8f4',surface:'#ffffff',text:'#32170f',muted:'#79574c',primary:'#d64f27',accent:'#8b5cf6'},
    dark:{background:'#190b08',surface:'#29130e',text:'#fff5ef',muted:'#c9a095',primary:'#fb8a5c',accent:'#c4a1ff'},
  },
  Ocean: {
    light:{background:'#f2fbfc',surface:'#ffffff',text:'#08282e',muted:'#4b6d73',primary:'#087b8c',accent:'#5b5ce2'},
    dark:{background:'#031114',surface:'#092228',text:'#effdff',muted:'#91b5bb',primary:'#65d9e8',accent:'#9a9bff'},
  },
}

/** Default native palette retained for TUI and mobile consumers. */
export const rueNativeThemes: Record<RueMode,RuePalette> = rueNativeThemePalettes.Rue

export function applyRueTheme(theme:RueTheme,mode:RueMode){
  if(typeof document==='undefined')return
  document.documentElement.dataset.theme=theme
  document.documentElement.dataset.mode=mode
  localStorage.setItem('rue.theme',theme)
  localStorage.setItem('rue.mode',mode)
}
export function readRueTheme():{theme:RueTheme;mode:RueMode}{
  if(typeof localStorage==='undefined')return{theme:'Rue',mode:'light'}
  const theme=localStorage.getItem('rue.theme') as RueTheme
  const mode=localStorage.getItem('rue.mode') as RueMode
  return{theme:rueThemes.includes(theme)?theme:'Rue',mode:rueModes.includes(mode)?mode:'light'}
}
