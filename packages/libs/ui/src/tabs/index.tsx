import * as React from 'react'
import * as Primitive from '@radix-ui/react-tabs'
import {cn} from '../_utils/cn.js'
export function Tabs(props:React.ComponentProps<typeof Primitive.Root>){return <Primitive.Root {...props}/>}
export function TabsList({className,...props}:React.ComponentProps<typeof Primitive.List>){return <Primitive.List className={cn('inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-2 p-1',className)} {...props}/>}
export function TabsTrigger({className,...props}:React.ComponentProps<typeof Primitive.Trigger>){return <Primitive.Trigger className={cn('rounded-md px-3 py-2 text-sm font-medium text-muted outline-none transition-colors focus-visible:ring-2 focus-visible:ring-control/30 disabled:opacity-50 data-[state=active]:bg-elevated data-[state=active]:text-foreground data-[state=active]:shadow-sm',className)} {...props}/>}
export function TabsContent({className,...props}:React.ComponentProps<typeof Primitive.Content>){return <Primitive.Content className={cn('mt-4 outline-none focus-visible:ring-2 focus-visible:ring-control/30',className)} {...props}/>}
