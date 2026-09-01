import type {CSSProperties} from 'react'
import type {RueSession} from '@multiterm/rue-sdk'
export const botPalette=[
  {name:'Chief',role:'Daily operator',color:'var(--rue-bot-1)',shape:'round'},
  {name:'Sales Outbound',role:'Pipeline builder',color:'var(--rue-bot-2)',shape:'cloud'},
  {name:'Inbox Manager',role:'Message triage',color:'var(--rue-bot-3)',shape:'triangle'},
  {name:'Account Manager',role:'Customer follow-up',color:'var(--rue-bot-4)',shape:'round'},
  {name:'Talent Scout',role:'Research partner',color:'var(--rue-bot-5)',shape:'drop'},
  {name:'Expense Manager',role:'Receipt filing',color:'var(--rue-bot-6)',shape:'square'},
] as const
export function profileFor(session:RueSession,index:number){const base=botPalette[index%botPalette.length];const description=typeof session.meta.description==='string'&&session.meta.description.trim()?session.meta.description:base.role;return{...base,name:session.title||base.name,role:description}}
export function BotAvatar({index=0,size='md'}:{index?:number;size?:'sm'|'md'|'lg'}){const bot=botPalette[index%botPalette.length];return <span aria-hidden="true" className={`bot-avatar bot-avatar-${size} bot-shape-${bot.shape}`} style={{'--bot-color':bot.color} as CSSProperties}><i/><i/></span>}
