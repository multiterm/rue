import {test} from 'node:test'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])test(`sidebar grouping is selectable, contiguous and persisted at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`window.Keyname={ready:Promise.resolve(null),currentUser:async()=>({subject:'usr_test',userEmail:'test@example.test',principalType:'user'}),getAccessToken:async()=>'fixture',onAuthChange:()=>()=>{},signIn:async()=>null,signOut:async()=>{}}`}))
  const sessions=[['Work old','Work',false],['Personal pinned','Personal',true],['Work pinned','Work',true],['Loose pinned','',true],['Personal old','Personal',false]].map(([title,group,pinned],i)=>({id:`ses_group_${i}`,title,ownerSubject:'usr_test',createdAt:1,updatedAt:i,meta:{group,pinned},agent:null,provider:null,model:null,scopes:[],directory:null,parentId:null}))
  let preference,version=0,fail=false;const saved=[]
  await page.route(`${api}/**`,async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,json=body=>route.fulfill({json:body})
   if(path==='/sync/preferences')return json(preference?[preference]:[])
   if(path==='/sync/preferences/sidebar.group-agents'&&req.method()==='PUT'){
    const value=req.postDataJSON().value
    if(fail)return route.fulfill({status:503,json:{error:'unavailable'}})
    await new Promise(resolve=>setTimeout(resolve,150))
    preference={key:'sidebar.group-agents',value,version:++version,updatedAt:Date.now(),updatedByDevice:null};saved.push(value);return json(preference)
   }
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:sessions,nextCursor:null}}}}])
   if(path==='/session')return json(sessions)
   if(path.endsWith('/messages')||path.endsWith('/parts'))return json([])
   if(path==='/terminal/computers')return json({computers:[]})
   if(path==='/workers')return json({workers:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`)
  const nav=page.getByRole('navigation',{name:'Sessions',exact:true}),headings=nav.getByRole('heading')
  await expect(nav).toBeVisible();await expect(headings).toHaveCount(0)
  const open=()=>page.getByRole('button',{name:'Filter and sort bots',exact:true}).click()
  await open();const dialog=page.getByRole('dialog',{name:'Filter and sort bots',exact:true}),toggle=dialog.getByRole('checkbox',{name:'Group agents',exact:true})
  await toggle.check();await expect(headings).toHaveText(['Personal','Work','Ungrouped'])
  await expect.poll(()=>saved.at(-1)).toBe(true)
  await dialog.getByRole('button',{name:'Close filters',exact:true}).click()
  const order=await nav.locator('.bot-group-heading,.bot-list-copy>strong').allTextContents()
  expect(order).toEqual(['Personal','★ Personal pinned','Personal old','Work','★ Work pinned','Work old','Ungrouped','★ Loose pinned'])
  await page.reload();await expect(headings).toHaveText(['Personal','Work','Ungrouped'])
  await open();await expect(toggle).toBeChecked()
  // Fast interactions are serialized; only the latest selection is shown/saved.
  await toggle.uncheck();await toggle.check();await expect(headings).toHaveText(['Personal','Work','Ungrouped'])
  await expect.poll(()=>saved.slice(-2)).toEqual([false,true])
  fail=true;await toggle.click();await expect(dialog.getByRole('alert')).toContainText('Could not save agent grouping')
  await expect(toggle).toBeChecked();await expect(headings).toHaveText(['Personal','Work','Ungrouped'])
  fail=false;await dialog.getByRole('button',{name:'Reset filters',exact:true}).click();await expect.poll(()=>saved.at(-1)).toBe(false)
  await expect(headings).toHaveCount(0);await page.reload();await expect(headings).toHaveCount(0)
  await open();await expect(toggle).not.toBeChecked()
 }finally{await browser.close()}
})
