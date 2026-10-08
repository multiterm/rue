import {test} from 'node:test'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])test(`composer isolates placeholders, attachment drafts and failed-send recovery across bots at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const sessions=['General','Honeycluster'].map((title,i)=>({id:`ses_placeholder_${i}`,title,ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{},agent:null,provider:null,model:null,scopes:[],directory:null,parentId:null}))
  let rejectSend,sendStarted=false
  await page.route(`${api}/**`,route=>{
   const path=new URL(route.request().url()).pathname,json=body=>route.fulfill({json:body})
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:sessions,nextCursor:null}}}}])
   if(path==='/session')return json(sessions)
   if(path.endsWith('/message')&&route.request().method()==='POST'){
    sendStarted=true
    return new Promise(resolve=>{rejectSend=()=>route.fulfill({status:503,json:{error:'fixture_unavailable'}}).then(resolve)})
   }
   if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path==='/terminal/computers')return json({computers:[]})
   if(path==='/workers')return json({workers:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  const select=async name=>{
   const nav=page.getByRole('navigation',{name:'Sessions',exact:true})
   if(!await nav.isVisible())await page.getByRole('button',{name:/menu/i}).first().click()
   await nav.getByRole('button',{name:new RegExp(name)}).click()
  }
  await select('General')
  const input=page.locator('textarea.chat-composer-input'),hint=page.locator('.composer-placeholder')
  await expect(hint).toHaveText('Message General');await expect(input).not.toHaveAttribute('placeholder')
  // No field-value change: the parent bot selection must still update the field.
  for(let i=0;i<3;i++){
   const previous=await page.locator('form.composer').elementHandle()
   await select('Honeycluster');await expect(hint).toHaveText('Message Honeycluster')
   expect(await previous.evaluate(el=>el.isConnected)).toBe(false)
   await previous.dispose()
   await select('General');await expect(hint).toHaveText('Message General')
  }
  await input.fill('Typing a message\non two lines');await expect(hint).toHaveCount(0)
  await input.fill('');await expect(hint).toHaveText('Message General')
  await select('Honeycluster');await expect(hint).toHaveText('Message Honeycluster')
  await input.fill('Honeycluster draft');await expect(hint).toHaveCount(0)
  await select('General');await expect(hint).toHaveText('Message General')
  await select('Honeycluster');await expect(input).toHaveValue('Honeycluster draft');await expect(hint).toHaveCount(0)
  await page.getByLabel('Attach files',{exact:true}).setInputFiles({name:'draft.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic attachment fixture')})
  const rich=page.locator('.rich-composer'),chip=page.locator('.composer-file')
  await expect(chip).toHaveCount(1);await expect(rich).toContainText('Honeycluster draft');await expect(hint).toHaveCount(0)
  await select('General');await expect(chip).toHaveCount(0);await expect(hint).toHaveText('Message General')
  await input.fill('Separate General draft')
  await select('Honeycluster');await expect(chip).toHaveCount(1);await expect(rich).toContainText('Honeycluster draft')
  await page.getByRole('button',{name:'Send message',exact:true}).click()
  await expect.poll(()=>sendStarted).toBe(true)
  await select('General');await expect(input).toHaveValue('Separate General draft')
  await expect(input).toBeEnabled();await input.fill('Separate General draft edited while another agent sends')
  await rejectSend();await expect(input).toBeEnabled()
  await expect(input).toHaveValue('Separate General draft edited while another agent sends');await expect(hint).toHaveCount(0)
  await expect(input).toBeFocused()
  await select('Honeycluster');await expect(chip).toHaveCount(1);await expect(rich).toContainText('Honeycluster draft');await expect(hint).toHaveCount(0)
  await page.getByRole('button',{name:'Remove draft.txt',exact:true}).click()
  await input.fill('');await expect(hint).toHaveText('Message Honeycluster')
 }finally{await browser.close()}
})
