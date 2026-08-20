import * as React from 'react'
import { cn } from '../_utils/cn.js'
export function Card({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn('rounded-xl border border-border bg-surface text-foreground shadow-[var(--rue-shadow-soft)]',className)} {...props}/>}
export function CardHeader({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn('grid gap-1.5 p-6',className)} {...props}/>}
export function CardTitle({className,...props}:React.HTMLAttributes<HTMLHeadingElement>){return <h3 className={cn('m-0 font-display text-xl font-bold tracking-tight',className)} {...props}/>}
export function CardDescription({className,...props}:React.HTMLAttributes<HTMLParagraphElement>){return <p className={cn('m-0 text-sm leading-6 text-muted',className)} {...props}/>}
export function CardContent({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn('p-6 pt-0',className)} {...props}/>}
export function CardFooter({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn('flex items-center p-6 pt-0',className)} {...props}/>}
