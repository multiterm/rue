import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])test(`bot filter uses an outline funnel and opens filters at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session={id:'ses_filter',title:'Filter bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{},agent:null,provider:null,model:null,scopes:[],directory:null,parentId:null}
  await page.route(`${api}/**`,route=>{
   const path=new URL(route.request().url()).pathname,json=body=>route.fulfill({json:body})
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}])
   if(path==='/session')return json([session])
   if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path==='/terminal/computers')return json({computers:[]})
   if(path==='/workers')return json({workers:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  const button=page.getByRole('button',{name:'Filter and sort bots',exact:true}),icon=button.locator('svg')
  await expect(button).toBeVisible();await expect(icon).toHaveAttribute('fill','none');await expect(icon).toHaveAttribute('width','20')
  await expect(icon.locator('path')).toHaveAttribute('d','M3 4h18l-7 8v7l-4 2v-9Z')
  assert.equal(await icon.locator('path').evaluate(el=>getComputedStyle(el).fill),'none')
  assert.ok((await icon.boundingBox()).width>=18)
  await button.click();const dialog=page.getByRole('dialog',{name:'Filter and sort bots',exact:true});await expect(dialog).toBeVisible()
  await dialog.getByRole('checkbox',{name:'Pinned only',exact:true}).check()
  await dialog.getByRole('button',{name:'Close filters',exact:true}).click();await expect(dialog).toHaveCount(0)
  await expect(button.locator('svg')).toHaveAttribute('fill','none')
 }finally{await browser.close()}
})
