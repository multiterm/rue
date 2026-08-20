import * as React from 'react'
import { cn } from '../_utils/cn.js'
export function Input({className,...props}:React.InputHTMLAttributes<HTMLInputElement>){return <input className={cn('flex h-11 w-full rounded-md border border-border bg-surface px-3.5 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50',className)} {...props}/>}
export function Textarea({className,...props}:React.TextareaHTMLAttributes<HTMLTextAreaElement>){return <textarea className={cn('flex min-h-24 w-full resize-y rounded-md border border-border bg-surface px-3.5 py-3 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary focus:ring-2 focus:ring-primary/15',className)} {...props}/>}
export function Label({className,...props}:React.LabelHTMLAttributes<HTMLLabelElement>){return <label className={cn('text-sm font-semibold text-foreground',className)} {...props}/>}
