import {useEffect,useState} from 'react'
import {Link,Outlet,useLocation} from '@tanstack/react-router'
import {useQuery} from '@tanstack/react-query'
import {Input,PublicLayout,cn} from '@multiterm/rue-ui'
import {headings,type Heading} from './MarkdownPage'
import {checkHealth,pages} from '../router'
import {app} from '../app'
const nav=[{group:'Start',items:[['/','Introduction'],['/authentication','Authentication'],['/settings','Settings & support']]},{group:'Build',items:[['/design-system','Design system'],['/deployment','Deployment']]}] as const
export function DocsLayout(){
  const location=useLocation(), [query,setQuery]=useState(''), [active,setActive]=useState(window.location.hash.slice(1))
  const current=pages[location.pathname as keyof typeof pages]??pages['/'], pageHeadings:Heading[]=headings(current)
  const status=useQuery({queryKey:['rue','health'],queryFn:checkHealth,retry:false})
  useEffect(()=>{const update=()=>setActive(window.location.hash.slice(1)); update();window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update)},[location.pathname,location.hash])
  const groups=nav.map(group=>({...group,items:group.items.filter(([,label])=>`${group.group} ${label}`.toLowerCase().includes(query.trim().toLowerCase()))})).filter(group=>group.items.length)
  return <PublicLayout wide homeHref={app.urls.site} docsHref={app.urls.docs} loginHref={app.urls.login} supportHref={`${app.urls.github}/issues`} status={<span className={cn('text-xs',status.isSuccess?'text-success':'text-subtle')}>{status.isSuccess?'API connected':'API offline'}</span>}>
    <div className="mx-auto grid max-w-[1440px] grid-cols-[250px_minmax(0,820px)_190px] items-start gap-10 px-7 py-10 max-[1100px]:grid-cols-[230px_minmax(0,1fr)] max-[780px]:block max-[640px]:px-5">
      <aside className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto max-[780px]:static max-[780px]:mb-8">
        <Input type="search" aria-label="Search docs" placeholder="Search docs…" value={query} onChange={e=>setQuery(e.target.value)} className="mb-6"/>
        <nav aria-label="Documentation" className="grid gap-6">{groups.map(group=><section key={group.group}><h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-[.12em] text-subtle">{group.group}</h2><div className="grid gap-1">{group.items.map(([to,label])=><Link key={to} to={to} activeOptions={{exact:true}} aria-current={location.pathname===to?'page':undefined} className="rounded-[10px] px-3 py-2 text-sm font-semibold text-muted hover:bg-surface hover:text-foreground [&.active]:bg-surface [&.active]:text-foreground">{label}</Link>)}</div></section>)}</nav>
        {!groups.length&&<p className="text-sm text-muted">No matching pages.</p>}
      </aside>
      <main className="min-w-0"><Outlet/></main>
      <aside className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto max-[1100px]:hidden"><h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-[.12em] text-subtle">On this page</h2><nav aria-label="On this page" className="grid gap-1">{pageHeadings.map(heading=><a key={heading.id} href={`#${heading.id}`} aria-current={active===heading.id?'location':undefined} className={cn('border-l py-1 text-xs hover:text-foreground',active===heading.id?'border-primary text-foreground':'border-border text-muted',heading.level===3?'pl-6':'pl-3')}>{heading.label}</a>)}</nav></aside>
    </div>
  </PublicLayout>
}
