import type {HTMLAttributes} from 'react'
import {cn} from '../_utils/cn.js'

export function RueLogo({className,compact=false,inverse=false,...props}:HTMLAttributes<HTMLSpanElement>&{compact?:boolean;inverse?:boolean}){return <span className={cn('inline-flex items-center gap-2.5 font-display font-black tracking-[-.04em]',inverse?'text-inverse-foreground':'text-foreground',className)} {...props}><svg aria-hidden="true" viewBox="0 0 32 32" className="size-7 overflow-visible"><path d="M5 7.5c0-2 1.6-3.5 3.6-3.5h8.8C23.2 4 27 7.2 27 12c0 3.3-1.8 5.8-4.8 7.1L28 28h-7.2l-4.9-7.8H12V28H5V7.5Zm7 2v5h4.7c2 0 3.2-.9 3.2-2.5s-1.2-2.5-3.2-2.5H12Z" fill="currentColor"/><circle cx="26" cy="5" r="3" className="fill-bot-1"/></svg>{!compact&&<span>Rue</span>}</span>}
