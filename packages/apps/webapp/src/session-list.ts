import type {RueSession} from '@multiterm/rue-sdk'
export type BotListFilters={archive:'active'|'archived'|'all';pinnedOnly:boolean;sort:'recent'|'oldest'|'name'|'group';pinnedFirst:boolean;groupAgents:boolean}
export const defaultBotListFilters:BotListFilters={archive:'active',pinnedOnly:false,sort:'recent',pinnedFirst:true,groupAgents:false}
export const sessionGroup=(session:RueSession)=>typeof session.meta.group==='string'?session.meta.group.trim().slice(0,60):''
const group=sessionGroup
export function filterSessions(sessions:RueSession[],search:string,filters:BotListFilters=defaultBotListFilters){
 const query=search.trim().toLowerCase()
 return sessions.filter(session=>{
  const archived=session.meta.archived===true
  if(filters.archive!=='all'&&archived!==(filters.archive==='archived'))return false
  if(filters.pinnedOnly&&session.meta.pinned!==true)return false
  const labels=Array.isArray(session.meta.labels)?session.meta.labels.filter(value=>typeof value==='string'):[]
  return [session.title,group(session),...labels].join(' ').toLowerCase().includes(query)
 }).sort((a,b)=>{
  if(filters.groupAgents){
   const left=group(a),right=group(b)
   const grouped=left===right?0:!left?1:!right?-1:left.localeCompare(right)|| (left<right?-1:1)
   if(grouped)return grouped
  }
  const pinned=filters.pinnedFirst?Number(b.meta.pinned===true)-Number(a.meta.pinned===true):0
  if(pinned)return pinned
  const order=filters.sort==='name'?a.title.localeCompare(b.title):filters.sort==='oldest'?a.createdAt-b.createdAt:filters.sort==='group'?group(a).localeCompare(group(b))||b.updatedAt-a.updatedAt:b.updatedAt-a.updatedAt
  return order||a.id.localeCompare(b.id)
 })
}
