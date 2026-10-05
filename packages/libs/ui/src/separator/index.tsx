import type {ComponentProps} from 'react'
import {cn} from '../_utils/cn.js'
export function Separator({className,...props}:ComponentProps<'hr'>){return <hr className={cn('my-1 h-px w-full shrink-0 border-0 bg-separator',className)} {...props}/>}
