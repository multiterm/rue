import type {Page} from '@playwright/test'
/** Reuse existing session fixtures while the browser transitions from REST to tRPC.
 * The fetch runs in the page so Playwright's per-test REST routes still intercept it.
 */
export async function mockSessionTrpc(page:Page){
 await page.route('http://localhost:4097/trpc/sessionsPage*',async route=>{
  const all=await page.evaluate(async()=>{const response=await fetch('http://localhost:4097/session');return {ok:response.ok,data:await response.json()}})
  if(!all.ok||!Array.isArray(all.data))return route.fulfill({status:500,json:[{error:{json:{message:'Session fixture unavailable',code:-32603,data:{code:'INTERNAL_SERVER_ERROR',httpStatus:500}}}}]})
  const url=new URL(route.request().url()),inputs=JSON.parse(url.searchParams.get('input')??'{}')
  // StrictMode can cancel/reissue the query within one HTTP batch. Return one result per call.
  const results=url.pathname.split('/').at(-1)!.split(',').map((procedure,index)=>{
   if(procedure!=='sessionsPage')return {error:{json:{message:'Unknown fixture procedure',code:-32601,data:{code:'NOT_FOUND',httpStatus:404}}}}
   const input=inputs[String(index)]?.json??{},limit=input.limit??100,cursor=input.cursor
   const rows=all.data.slice().sort((a,b)=>b.updatedAt-a.updatedAt||b.id.localeCompare(a.id)).filter(row=>!cursor||row.updatedAt<cursor.updatedAt||(row.updatedAt===cursor.updatedAt&&row.id<cursor.id))
   const items=rows.slice(0,limit),last=items.at(-1),nextCursor=rows.length>limit&&last?{updatedAt:last.updatedAt,id:last.id}:null
   return {result:{data:{json:{items,nextCursor}}}}
  })
  return route.fulfill({json:results})
 })
}
