import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { cn } from '../_utils/cn.js'

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value
export function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger className={cn('flex h-[46px] w-full items-center justify-between rounded-lg border border-border bg-background px-3.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-control/30 disabled:opacity-50', className)} {...props}>{children}<SelectPrimitive.Icon aria-hidden>⌄</SelectPrimitive.Icon></SelectPrimitive.Trigger>
}
export function SelectContent({ children, className, ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content position="popper" sideOffset={4} className={cn('relative z-[60] max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-elevated text-foreground shadow-lg', className)} {...props}><SelectPrimitive.ScrollUpButton className="text-center">⌃</SelectPrimitive.ScrollUpButton><SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport><SelectPrimitive.ScrollDownButton className="text-center">⌄</SelectPrimitive.ScrollDownButton></SelectPrimitive.Content></SelectPrimitive.Portal>
}
export function SelectItem({ children, className, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item className={cn('relative flex cursor-default select-none items-center rounded-md py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50', className)} {...props}><span className="absolute left-2"><SelectPrimitive.ItemIndicator>✓</SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText></SelectPrimitive.Item>
}
