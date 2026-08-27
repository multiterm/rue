import type {MiddlewareHandler} from 'hono'
const windows=new Map<string,{startedAt:number;count:number}>()
const WINDOW_MS=60_000
const MAX_REQUESTS=120
const EXEMPT=new Set(['/health','/doc','/openapi.json'])
export function requestGuard():MiddlewareHandler{return async(context,next)=>{if(EXEMPT.has(context.req.path))return next();const subject=context.get('principal').subject;const now=Date.now();const current=windows.get(subject);if(!current||now-current.startedAt>=WINDOW_MS)windows.set(subject,{startedAt:now,count:1});else{current.count++;if(current.count>MAX_REQUESTS)return context.json({error:'RATE_LIMITED'},429,{'retry-after':String(Math.ceil((current.startedAt+WINDOW_MS-now)/1000))})}return next()}}
