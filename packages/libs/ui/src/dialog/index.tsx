import {Button} from '../button/index.js'
import {useEffect,useId,useRef,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {cn} from '../_utils/cn.js'
export function Dialog({open,onClose,title,description,children,footer,className}:{open:boolean;onClose:()=>void;title:string;description?:string;children:ReactNode;footer?:ReactNode;className?:string}){
 const id=useId(),root=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose
 useEffect(()=>{
  if(!open)return
  const previous=document.activeElement as HTMLElement|null
  const top=()=>Array.from(document.querySelectorAll('[role="dialog"]')).at(-1)===root.current
  const controls=()=>Array.from(root.current?.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]')??[]).filter(e=>e.tabIndex>=0&&!e.matches(':disabled')&&e.getClientRects().length>0)
  if(!root.current?.contains(document.activeElement))((root.current?.querySelector('input:not(:disabled),textarea:not(:disabled)') as HTMLElement|null)??controls()[0]??root.current)?.focus()
  const keydown=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||!top())return
   if(event.key==='Escape'){event.preventDefault();close.current()}
   if(event.key==='Tab'){
    const elements=controls(),first=elements[0],last=elements.at(-1)
    if(!elements.length){event.preventDefault();root.current?.focus()}
    else if(!root.current?.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first)?.focus()}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
   }
  }
  window.addEventListener('keydown',keydown)
  return()=>{window.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus({preventScroll:true})}
 },[open])
 if(!open)return null
 return createPortal(<div className="fixed inset-0 z-50 grid place-items-center bg-overlay p-5 backdrop-blur-[2px]" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)onClose()}}><section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description?`${id}-description`:undefined} className={cn('w-full max-w-md rounded-2xl border border-border bg-elevated p-6 text-foreground shadow-[var(--rue-shadow-hard)]',className)}><header className="mb-6 flex items-start justify-between gap-6"><div><h2 id={`${id}-title`} className="m-0 font-display text-xl font-bold tracking-tight">{title}</h2>{description&&<p id={`${id}-description`} className="mb-0 mt-2 text-sm leading-6 text-muted">{description}</p>}</div><Button variant="bare" type="button" aria-label="Close dialog" onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-full border-0 bg-surface-2 text-muted hover:text-foreground">×</Button></header>{children}{footer&&<footer className="mt-7 flex justify-end gap-2 border-t border-border pt-5">{footer}</footer>}</section></div>,document.body)
}
