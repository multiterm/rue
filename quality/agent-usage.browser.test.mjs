import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])test(`per-agent usage filters and errors at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
 const page=await browser.newPage({viewport:{width,height:915}})
 await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'text/javascript',body:`window.Keyname={ready:Promise.resolve(null),currentUser:async()=>({subject:'usr_test',userEmail:'test@example.test',principalType:'user'}),getAccessToken:async()=>'fixture',onAuthChange:()=>()=>{},signOut:async()=>{},signIn:async()=>null}` }))
 const session={id:'ses_usage',title:'Metered agent',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{},agent:'pi-terminal',terminalConnectionId:'term_usage',provider:'openai',model:'test',scopes:[],directory:null,parentId:null}
 let mode='data';const requests=[]
 await page.route(`${api}/**`,route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,json=body=>route.fulfill({json:body})
  if(path===`/session/${session.id}/usage`){
   requests.push(url.searchParams.get('days'))
   if(mode==='error')return route.fulfill({status:503,json:{error:'unavailable'}})
   const now=Date.now(),today=Math.floor(now/86400000)*86400000,days=Number(url.searchParams.get('days'))
   return json({ownerSubject:mode==='foreign'?'someone-else':'usr_test',sessionId:session.id,from:today-(days-1)*86400000,to:now,timezone:'UTC',basis:'runtime-estimate',rows:mode==='empty'?[]:[
    {time:today,provider:'openai',credentialId:'key_'+'a'.repeat(64),requests:2,input:100,output:10,cacheRead:20,cacheWrite:0,costUsd:0.1,unpricedRequests:0},
    {time:today,provider:'openai',credentialId:'key_'+'b'.repeat(64),requests:1,input:200,output:20,cacheRead:0,cacheWrite:0,costUsd:0.2,unpricedRequests:0},
    {time:today,provider:'openai-codex',credentialId:null,requests:1,input:300,output:30,cacheRead:0,cacheWrite:0,costUsd:null,unpricedRequests:1},
   ]})
  }
  if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}])
  if(path==='/session')return json([session]);if(path===`/session/${session.id}`)return json(session)
  if(path==='/terminal/computers')return json({computers:[]})
  if(path==='/provider-keys')return json({ownerSubject:'usr_test',keyStorageAvailable:true,keys:[]})
  if(path==='/provider-keys/catalog')return json({providers:[]})
  if(path==='/device/register')return json({})
  if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
  if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
  return route.fulfill({status:404,json:{error:'not_found'}})
 })
 await page.goto(`${web}/login`)
 await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Metered agent/}).click()
 await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Settings',exact:true}).click()
 const panel=page.getByRole('complementary',{name:'Settings',exact:true})
 await panel.getByRole('button',{name:'Usage',exact:true}).click()
 await expect(panel.getByRole('heading',{name:'Agent usage',exact:true})).toBeVisible()
 const usage=panel.getByRole('region',{name:'Agent usage',exact:true}),table=usage.getByRole('table')
 await expect(table.getByRole('row')).toHaveCount(4)
 await expect(usage).toContainText('runtime price estimates')
 await usage.getByLabel('Usage provider',{exact:true}).click();await page.getByRole('option',{name:'openai',exact:true}).click()
 await expect(table.getByRole('row')).toHaveCount(3)
 await usage.getByLabel('Usage credential',{exact:true}).click();await page.getByRole('option',{name:'Saved key · aaaaaaaaaaaa',exact:true}).click()
 await expect(table.getByRole('row')).toHaveCount(2);await expect(table).toContainText('$0.10')
 await usage.getByLabel('Usage date range',{exact:true}).click();await page.getByRole('option',{name:'Last 7 days',exact:true}).click()
 await expect.poll(()=>requests.at(-1)).toBe('7')
 mode='foreign';await usage.getByRole('button',{name:'Refresh usage',exact:true}).click();await expect(usage.getByRole('alert')).toContainText('could not be loaded');await expect(table).toHaveCount(0)
 mode='empty';await usage.getByRole('button',{name:'Refresh usage',exact:true}).click();await expect(usage).toContainText('No usage recorded')
 mode='error';await usage.getByRole('button',{name:'Refresh usage',exact:true}).click();await expect(usage.getByRole('alert')).toContainText('Missing data is not zero spending')
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No horizontal page overflow')
 }finally{await browser.close()}
})
