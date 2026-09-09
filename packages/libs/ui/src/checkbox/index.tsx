import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { cn } from '../_utils/cn.js'

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root className={cn('grid size-5 shrink-0 place-items-center rounded border border-border bg-background text-foreground outline-none focus-visible:ring-2 focus-visible:ring-control/30 data-[state=checked]:border-control data-[state=checked]:bg-control data-[state=checked]:text-control-foreground disabled:opacity-50', className)} {...props}><CheckboxPrimitive.Indicator>✓</CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>
}
