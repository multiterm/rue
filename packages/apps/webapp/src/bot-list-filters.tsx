import {Button,Checkbox,FilterPopover,Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@multiterm/rue-ui'
import {defaultBotListFilters,type BotListFilters} from './session-list'
export function BotListFilterMenu({value,onChange,error}:{value:BotListFilters;onChange(value:BotListFilters):void;error?:string}){
 const active=Object.keys(defaultBotListFilters).some(key=>value[key as keyof BotListFilters]!==defaultBotListFilters[key as keyof BotListFilters])
 return <FilterPopover label="Filter and sort bots" active={active} icon="funnel">
 <div className="grid gap-2 text-sm"><span>Show bots</span><Select value={value.archive} onValueChange={archive=>onChange({...value,archive:archive as BotListFilters['archive']})}><SelectTrigger aria-label="Show bots"><SelectValue/></SelectTrigger><SelectContent className="z-[80]"><SelectItem value="active">Active (hide archived)</SelectItem><SelectItem value="archived">Archived only</SelectItem><SelectItem value="all">All bots</SelectItem></SelectContent></Select></div>
 <label className="flex items-center gap-2 text-sm"><Checkbox checked={value.pinnedOnly} onCheckedChange={checked=>onChange({...value,pinnedOnly:checked===true})}/>Pinned only</label>
 <div className="grid gap-2 text-sm"><span>Sort by</span><Select value={value.sort} onValueChange={sort=>onChange({...value,sort:sort as BotListFilters['sort']})}><SelectTrigger aria-label="Sort by"><SelectValue/></SelectTrigger><SelectContent className="z-[80]"><SelectItem value="recent">Recently updated</SelectItem><SelectItem value="oldest">Oldest created</SelectItem><SelectItem value="name">Name (A–Z)</SelectItem><SelectItem value="group">Group</SelectItem></SelectContent></Select></div>
 <label className="flex items-center gap-2 text-sm"><Checkbox checked={value.groupAgents} onCheckedChange={checked=>onChange({...value,groupAgents:checked===true})}/>Group agents</label>
 {value.groupAgents&&<p className="m-0 text-xs text-muted">Groups appear alphabetically, with Ungrouped last. Sorting and pinned priority apply within each group.</p>}
 {error&&<p role="alert" className="m-0 text-xs text-muted">{error}</p>}
 <label className="flex items-center gap-2 text-sm"><Checkbox checked={value.pinnedFirst} onCheckedChange={checked=>onChange({...value,pinnedFirst:checked===true})}/>Pinned bots first</label>
 <Button type="button" variant="ghost" onClick={()=>onChange({...defaultBotListFilters})}>Reset filters</Button>
 </FilterPopover>
}
