import * as React from 'react'
import {cva,type VariantProps} from 'class-variance-authority'
import {cn} from '../_utils/cn.js'
export type ButtonMode='Primary'|'Secondary'|'Warning'|'Danger'|'Success'
const chrome='relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border font-semibold'
export const buttonVariants=cva('rue-button cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control disabled:cursor-not-allowed disabled:opacity-50',{
  variants:{
    variant:{
      primary:'border-transparent bg-control text-control-foreground enabled:hover:brightness-110 enabled:active:brightness-95',
      secondary:'border-transparent bg-inverse text-inverse-foreground enabled:hover:brightness-110 enabled:active:brightness-95',
      outline:'border-border-strong bg-transparent text-foreground enabled:hover:border-control enabled:hover:bg-surface-2 enabled:active:bg-surface',
      ghost:'border-transparent bg-transparent text-muted enabled:hover:bg-surface enabled:hover:text-foreground enabled:active:bg-surface-2',
      destructive:'border-transparent bg-danger text-danger-foreground enabled:hover:brightness-110 enabled:active:brightness-95',
      // Application-specific layouts retain their geometry, not their own behavior.
      bare:'enabled:hover:brightness-110 enabled:active:brightness-95',
    },
    size:{bare:'',mini:'min-h-6 px-2 py-0.5 text-[11px]',sm:'min-h-8 px-2.5 py-1 text-xs',regular:'min-h-9 px-4 py-2 text-sm',default:'min-h-9 px-4 py-2 text-sm',lg:'min-h-10 px-6 py-2.5 text-sm',icon:'size-9 p-0'},
  },
  compoundVariants:[{variant:['primary','secondary','outline','ghost','destructive'],class:chrome}],
  defaultVariants:{variant:'primary',size:'regular'},
})
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>,VariantProps<typeof buttonVariants>{mode?:ButtonMode;isLoading?:boolean}
export const Button=React.forwardRef<HTMLButtonElement,ButtonProps>(({className,variant,size,mode='Primary',type='button',isLoading=false,children,disabled,...props},ref)=><button {...props} ref={ref} type={type} data-variant={variant??'primary'} data-mode={variant==='bare'?undefined:variant==='destructive'?'Danger':mode} className={cn(buttonVariants({variant,size:variant==='bare'&&!size?'bare':size}),className)} disabled={disabled||isLoading||props['aria-disabled']===true||props['aria-disabled']==='true'} aria-busy={isLoading||props['aria-busy']}>{isLoading?<><span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"/>Loading…</>:children}</button>)
Button.displayName='Button'
export interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement>,VariantProps<typeof buttonVariants>{mode?:ButtonMode;disabled?:boolean;isLoading?:boolean}
export function ButtonLink({className,variant,size,mode='Primary',children,disabled=false,isLoading=false,href,onClick,onAuxClick,tabIndex,...props}:ButtonLinkProps){
  const blocked=disabled||isLoading||props['aria-disabled']===true||props['aria-disabled']==='true'
  // Anchors have no native disabled behavior: remove navigation and keyboard activation.
  return <a {...props} role={props.role??'link'} data-variant={variant??'primary'} data-mode={variant==='bare'?undefined:mode} className={cn(buttonVariants({variant,size:variant==='bare'&&!size?'bare':size}),!blocked&&'hover:brightness-110',blocked&&'cursor-not-allowed opacity-50',className)} href={blocked?undefined:href} aria-disabled={blocked||undefined} aria-busy={isLoading||undefined} tabIndex={blocked?-1:tabIndex} onClick={event=>{if(blocked){event.preventDefault();event.stopPropagation()}else onClick?.(event)}} onAuxClick={event=>{if(blocked){event.preventDefault();event.stopPropagation()}else onAuxClick?.(event)}}>{children}</a>
}
