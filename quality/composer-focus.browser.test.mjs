import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])test(`new workspace keeps focus through stale lists; agent switches do not wait for old reads at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 const held=[]
 try{
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`window.Keyname={ready:Promise.resolve(null),currentUser:async()=>({subject:'usr_test',userEmail:'test@example.test',principalType:'user'}),getAccessToken:async()=>'fixture',onAuthChange:()=>()=>{},signIn:async()=>null,signOut:async()=>{}}`}))
  const make=(id,title)=>({id,title,ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{},agent:null,provider:null,model:null,scopes:[],directory:null,parentId:null})
  const old=make('ses_existing','Existing bot'),created=make('ses_new','New workspace')
  const aborted=[]
  page.on('requestfailed',request=>{if(request.url().includes('/session/ses_new/')&&request.failure()?.errorText.includes('ABORTED'))aborted.push(request.url())})
  let omit=false,exists=false,listReads=0,detailReads=0,slow=false,eventId=0
  await page.route(`${api}/**`,route=>{
   const req=route.request(),path=new URL(req.url()).pathname,json=body=>route.fulfill({json:body})
   if(path==='/trpc/sessionsPage'){listReads++;return json([{result:{data:{json:{items:exists&&!omit?[created,old]:[old],nextCursor:null}}}}])}
   if(path==='/session'&&req.method()==='POST'){exists=true;return json(created)}
   if(path===`/session/${created.id}`){detailReads++;return json(created)}
   if(path===`/session/${old.id}`)return json(old)
   if(path.endsWith('/messages')||path.endsWith('/parts')){
    if(slow&&path.includes(created.id))return new Promise(resolve=>held.push(()=>route.fulfill({json:[]}).catch(()=>{}).then(resolve)))
    return json([])
   }
   if(path==='/sync/preferences')return json([])
   if(path==='/terminal/computers')return json({computers:[]})
   if(path==='/workers')return json({workers:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:`id: ${++eventId}\ndata: ${JSON.stringify({id:eventId,type:'session.updated',time:Date.now(),payload:{sessionId:old.id}})}\n\n`})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`)
  await page.getByRole('button',{name:'Create bot',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Add new bot',exact:true}),name=dialog.getByLabel('Bot name',{exact:true})
  await name.fill('New workspace');const nameNode=await name.elementHandle()
  const before=listReads;await expect.poll(()=>listReads,{timeout:15000}).toBeGreaterThan(before)
  assert.equal(await nameNode.evaluate(el=>el.isConnected&&document.activeElement===el),true)
  await dialog.getByRole('button',{name:'Add bot',exact:true}).click();await expect(dialog).toHaveCount(0)
  const input=page.locator('textarea.chat-composer-input')
  await expect(input).toHaveAttribute('aria-placeholder','Message New workspace')
  await input.fill('A draft that must stay here');await input.press('End')
  const inputNode=await input.elementHandle(),formNode=await page.locator('form.composer').elementHandle()
  omit=true
  const reads=listReads;await expect.poll(()=>listReads,{timeout:15000}).toBeGreaterThan(reads+1)
  await expect.poll(()=>detailReads).toBeGreaterThan(0)
  await expect(input).toHaveAttribute('aria-placeholder','Message New workspace')
  assert.equal(await inputNode.evaluate(el=>el.isConnected&&document.activeElement===el),true)
  assert.equal(await formNode.evaluate(el=>el.isConnected),true)
  await page.setViewportSize({width,height:500})
  await input.pressSequentially(' while the keyboard is open')
  await expect(input).toHaveValue('A draft that must stay here while the keyboard is open')
  assert.equal(await inputNode.evaluate(el=>document.activeElement===el),true)
  await page.setViewportSize({width,height:900})
  omit=false;slow=true
  await expect.poll(()=>held.length,{timeout:20000}).toBeGreaterThan(0)
  const select=async title=>{const nav=page.getByRole('navigation',{name:'Sessions',exact:true});if(!await nav.isVisible())await page.getByRole('button',{name:/menu/i}).first().click();await nav.getByRole('button',{name:new RegExp(title)}).click()}
  await select('Existing bot')
  // The old request is still held: selection and the new composer must not wait for it.
  await expect(input).toHaveAttribute('aria-placeholder','Message Existing bot')
  await input.fill('Separate existing draft')
  slow=false;await Promise.all(held.splice(0).map(release=>release()))
  await expect.poll(()=>aborted.length).toBeGreaterThan(0)
  await select('New workspace');await expect(input).toHaveValue('A draft that must stay here while the keyboard is open')
  await select('Existing bot');await expect(input).toHaveValue('Separate existing draft')
 }finally{await Promise.all(held.map(release=>release()));await browser.close()}
})
