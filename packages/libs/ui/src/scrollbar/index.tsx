// Adapted from Portal's shadcn/Radix ScrollArea, with Rue GDS tokens.
import { forwardRef, type ComponentPropsWithoutRef, type Ref } from 'react'
import * as Primitive from '@radix-ui/react-scroll-area'
import { cn } from '../_utils/cn.js'
import './scrollbar.css'

type Props = ComponentPropsWithoutRef<typeof Primitive.Root> & { orientations?:readonly ('vertical'|'horizontal')[]; viewportRef?: Ref<HTMLDivElement>; viewportClassName?: string; onViewportScroll?: React.UIEventHandler<HTMLDivElement> }
export const Scrollbar = forwardRef<HTMLDivElement, Props>(({ children, className, viewportRef, viewportClassName, onViewportScroll, orientations=['vertical','horizontal'], ...props }, ref) => <Primitive.Root ref={ref} type="auto" className={cn('rue-scrollbar relative min-h-0 min-w-0 overflow-hidden', className)} {...props}>
  <Primitive.Viewport ref={viewportRef} onScroll={onViewportScroll} className={cn('rue-scroll-viewport h-full w-full rounded-[inherit]', viewportClassName)}>{children}</Primitive.Viewport>
  {orientations.map(orientation => <Primitive.Scrollbar key={orientation} orientation={orientation} className={cn('rue-scroll-track flex touch-none select-none p-[2px]', orientation === 'vertical' ? 'w-2.5' : 'h-2.5 flex-col')}><Primitive.Thumb className="relative flex-1 rounded-full bg-border hover:bg-muted"/></Primitive.Scrollbar>)}
  <Primitive.Corner/>
</Primitive.Root>)
Scrollbar.displayName = 'Scrollbar'
export const ScrollArea = Scrollbar
