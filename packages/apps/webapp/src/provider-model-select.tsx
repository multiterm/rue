import {useDeferredValue,useMemo,useState} from 'react'
import {Input,Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@multiterm/rue-ui'
export function ProviderModelSelect({models,value,onChange,disabled=false}:{models:Array<{id:string;name:string}>;value:string;onChange(value:string):void;disabled?:boolean}){
 const [search,setSearch]=useState(''),query=useDeferredValue(search.trim().toLowerCase())
 const matches=useMemo(()=>models.filter(model=>`${model.name} ${model.id}`.toLowerCase().includes(query)),[models,query])
 const visible=matches.slice(0,100),selected=models.find(model=>model.id===value)
 if(selected&&!visible.some(model=>model.id===selected.id))visible.unshift(selected)
 return <div className="grid min-w-0 gap-2"><Input label="Find bot models" type="search" autoComplete="off" value={search} onChange={event=>setSearch(event.target.value)} disabled={disabled} placeholder="Search available models" show={{label:true,hideRequireType:true}}/>
 <Select value={selected?value:''} onValueChange={next=>{if(models.some(model=>model.id===next))onChange(next)}} disabled={disabled||!models.length}><SelectTrigger aria-label="Model ID"><SelectValue placeholder="Choose a model"/></SelectTrigger><SelectContent>{visible.map(model=><SelectItem key={model.id} value={model.id}>{model.name} · {model.id}</SelectItem>)}</SelectContent></Select>
 {matches.length>100&&<p className="text-xs text-muted">Showing 100 of {matches.length} matches. Refine your search.</p>}{query&&!matches.length&&<p role="status" className="text-xs text-muted">No matching models. The current selection is retained.</p>}
 <p className="text-xs text-muted">Supported runtime catalog; provider account access may vary.</p></div>
}
