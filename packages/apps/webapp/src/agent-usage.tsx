import {useEffect,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Button,Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@multiterm/rue-ui'
import type {RueSession} from '@multiterm/rue-sdk'
import {rue} from './client'
const usd=(value:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:4}).format(value)
const keyLabel=(id:string|null)=>id?`Saved key · ${id.slice(4,16)}`:'Unattributed / local / OAuth'
export function AgentUsagePage({session}:{session:RueSession}){
 const [days,setDays]=useState<7|30|90>(30),[provider,setProvider]=useState('all'),[credential,setCredential]=useState('all'),[metric,setMetric]=useState('cost')
 useEffect(()=>{setProvider('all');setCredential('all')},[session.id,session.ownerSubject])
 const query=useQuery({queryKey:['agent-usage',session.ownerSubject,session.id,days],queryFn:()=>rue.agentUsage(session.id,days),retry:false,refetchInterval:60000})
 const report=query.data?.ownerSubject===session.ownerSubject&&query.data.sessionId===session.id?query.data:undefined
 const all=report?.rows??[],providers=[...new Set(all.map(row=>row.provider))].sort()
 const forProvider=all.filter(row=>provider==='all'||row.provider===provider),keys=[...new Set(forProvider.map(row=>row.credentialId??'unknown'))]
 const rows=forProvider.filter(row=>credential==='all'||(row.credentialId??'unknown')===credential)
 const totals=rows.reduce((total,row)=>({requests:total.requests+row.requests,cost:total.cost+(row.costUsd??0),unpriced:total.unpriced+row.unpricedRequests,tokens:total.tokens+row.input+row.output+row.cacheRead+row.cacheWrite}),{requests:0,cost:0,unpriced:0,tokens:0})
 const series=report?Array.from({length:days},(_,index)=>{const time=report.from+index*86400000,day=rows.filter(row=>row.time===time);return {time,reported:day.length>0,value:day.reduce((sum,row)=>sum+(metric==='cost'?(row.costUsd??0):row.input+row.output+row.cacheRead+row.cacheWrite),0)}}):[]
 const maximum=Math.max(1e-9,...series.map(day=>day.value))
 return <section className="grid gap-4" aria-label="Agent usage">
 <p className="text-sm text-muted">Reported model usage for this agent. USD values are runtime price estimates—not provider invoices or credit balances. Tokens and subscription usage are not converted into credits.</p>
 <div className="grid gap-2">
 <Select value={String(days)} onValueChange={value=>setDays(Number(value) as 7|30|90)}><SelectTrigger aria-label="Usage date range"><SelectValue/></SelectTrigger><SelectContent>{[7,30,90].map(value=><SelectItem key={value} value={String(value)}>Last {value} days</SelectItem>)}</SelectContent></Select>
 <Select value={provider} onValueChange={value=>{setProvider(value);setCredential('all')}}><SelectTrigger aria-label="Usage provider"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All providers</SelectItem>{providers.map(value=><SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
 <Select value={credential} onValueChange={setCredential}><SelectTrigger aria-label="Usage credential"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All credentials</SelectItem>{keys.map(value=><SelectItem key={value} value={value}>{keyLabel(value==='unknown'?null:value)}</SelectItem>)}</SelectContent></Select>
 <Select value={metric} onValueChange={setMetric}><SelectTrigger aria-label="Usage chart metric"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="cost">Estimated USD</SelectItem><SelectItem value="tokens">Tokens</SelectItem></SelectContent></Select>
 </div>
 {query.isPending?<p role="status">Loading usage…</p>:query.isError||!report?<p role="alert">Usage could not be loaded. Missing data is not zero spending.</p>:<>
 <dl className="bot-settings-facts"><div><dt>Reported requests</dt><dd>{totals.requests.toLocaleString()}</dd></div><div><dt>Tokens including cache</dt><dd>{totals.tokens.toLocaleString()}</dd></div><div><dt>Estimated USD</dt><dd>{totals.requests>totals.unpriced?usd(totals.cost):'Not reported'}</dd></div><div><dt>Requests without pricing</dt><dd>{totals.unpriced.toLocaleString()}</dd></div></dl>
 {!rows.length?<p>No usage recorded for this selection. Collection requires an updated agent runtime and API. Earlier usage cannot be reconstructed from current key grants or cumulative status counters.</p>:<>
 <figure className="m-0"><svg role="img" aria-label={`Daily ${metric==='cost'?'estimated USD':'tokens'} over ${days} days, UTC. Exact values in the table below.`} viewBox="0 0 360 120" width="100%" height="120">{series.map((day,index)=><rect key={day.time} x={index*360/days} y={110-day.value/maximum*100} width={Math.max(1,360/days-2)} height={day.value/maximum*100} fill="currentColor"><title>{new Date(day.time).toISOString().slice(0,10)}: {day.reported?(metric==='cost'?usd(day.value):day.value.toLocaleString()):'No reported usage'}</title></rect>)}</svg><figcaption className="text-xs text-muted">Daily buckets in UTC. Gaps mean no reports; unpriced requests are excluded from USD bars.</figcaption></figure>
 <div className="overflow-x-auto"><table className="text-sm w-full"><caption>Daily usage by provider and credential</caption><thead><tr>{['Date (UTC)','Provider / credential','Input','Output','Cache read / write','Estimated USD'].map(title=><th key={title} scope="col" className="text-left p-2">{title}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={`${row.time}:${row.provider}:${row.credentialId}`}><th scope="row" className="p-2">{new Date(row.time).toISOString().slice(0,10)}</th><td className="p-2">{row.provider}<br/><span className="text-xs text-muted">{keyLabel(row.credentialId)}</span></td><td className="p-2">{row.input.toLocaleString()}</td><td className="p-2">{row.output.toLocaleString()}</td><td className="p-2">{row.cacheRead.toLocaleString()} / {row.cacheWrite.toLocaleString()}</td><td className="p-2">{row.costUsd===null?'Not reported':usd(row.costUsd)}{row.unpricedRequests>0&&<span className="block text-xs text-muted">{row.unpricedRequests} unpriced</span>}</td></tr>)}</tbody></table></div>
 </>}
 </>}
 <Button type="button" variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh usage</Button>
 <p className="text-xs text-muted">Saved-key identifiers are opaque—not key values or suffixes. Local credentials and OAuth remain unattributed when the runtime cannot identify them. Linked agents must enable status sharing.</p>
 </section>
}
