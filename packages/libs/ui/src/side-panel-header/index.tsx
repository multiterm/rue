import {ChevronLeft,X} from 'lucide-react'
import {Button} from '../button/index.js'
import {cn} from '../_utils/cn.js'
export function SidePanelHeader({title,subtitle,headingId,onBack,backLabel='Back',onClose,closeLabel='Close panel',disabled=false,className}:{
 title:string;subtitle?:string;headingId:string;onBack?:()=>void;backLabel?:string;onClose():void;closeLabel?:string;disabled?:boolean;className?:string
}){
 return <header className={cn('flex shrink-0 items-center gap-3 border-b border-separator bg-elevated px-5 py-4',className)}>
 {onBack&&<Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={backLabel} title={backLabel} disabled={disabled} onClick={onBack}><ChevronLeft size={18} aria-hidden="true"/></Button>}
 <div className="min-w-0 flex-1"><h2 id={headingId} tabIndex={-1} className="m-0 text-base font-semibold leading-6 text-foreground">{title}</h2>{subtitle&&<p className="m-0 truncate text-xs leading-5 text-muted" title={subtitle}>{subtitle}</p>}</div>
 <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={closeLabel} title={closeLabel} disabled={disabled} onClick={onClose}><X size={18} aria-hidden="true"/></Button>
 </header>
}
