import * as React from 'react'
import { cn } from '../_utils/cn.js'
export function Badge({className,...props}:React.HTMLAttributes<HTMLSpanElement>){return <span className={cn('inline-flex items-center rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted',className)} {...props}/>}
