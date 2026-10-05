export const settingsPageTitles={
 Settings:'Bot settings',Usage:'Agent usage',Routines:'Routine draft',Connection:'Connection details','AI settings':'AI settings',Actions:'Agent actions',Status:'Agent status',Workspace:'Workspace',Permissions:'Permissions','Expired queue':'Expired Requests',
} as const
export type SettingsPage=keyof typeof settingsPageTitles
export function settingsBackLabel(page:SettingsPage){const title=settingsPageTitles[page];return `Back to ${page==='AI settings'?title:title[0]!.toLowerCase()+title.slice(1)}`}
export type SettingsNavigation={type:'push';page:SettingsPage}|{type:'back'}
export function settingsEntryPage(page:SettingsPage,action:string):SettingsPage{
 return page==='Actions'&&action==='workspace'?'Workspace':page==='Actions'&&action==='permissions'?'Permissions':page
}
export function initialSettingsHistory(page:SettingsPage):SettingsPage[]{return page==='Settings'?['Settings']:['Settings',page]}
export function settingsNavigate(history:SettingsPage[],action:SettingsNavigation):SettingsPage[]{
 if(action.type==='back')return history.length>1?history.slice(0,-1):history
 return history.at(-1)===action.page?history:[...history,action.page]
}
