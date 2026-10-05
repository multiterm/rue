import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const viewport of [{width:1280,height:900},{width:412,height:915}])test(`screenshot fallback, frame capture and cancellation at ${viewport.width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const context=await browser.newContext({viewport}),page=await context.newPage();let sends=0
  await page.addInitScript(()=>{Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:undefined,writable:true,configurable:true})})
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session={id:'ses_screenshot',title:'Screenshot bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{},agent:null,provider:null,model:null,scopes:[],directory:null,parentId:null}
  await page.route(`${api}/**`,route=>{const path=new URL(route.request().url()).pathname,json=body=>route.fulfill({json:body});if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}]);if(path==='/session')return json([session]);if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([]);if(path==='/terminal/computers')return json({computers:[]});if(path==='/workers')return json({workers:[]});if(path==='/device/register')return json({});if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});if(path.endsWith('/message')){sends++;return json({})}return route.fulfill({status:404,json:{error:'not_found'}})})
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Screenshot bot/}).click()
  const input=page.getByRole('textbox',{name:'Message',exact:true});await input.fill('Debug context')
  async function screenshot(){await page.getByRole('button',{name:'Chat actions',exact:true}).click();await page.getByRole('button',{name:'Take screenshot',exact:true}).click()}
  await screenshot();const dialog=page.getByRole('dialog',{name:'Attach a screenshot',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText('not sent until you press Send')
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(input).toHaveValue('Debug context')
  await screenshot();const chooser=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'Choose screenshot',exact:true}).click();await (await chooser).setFiles({name:'Debug screenshot.png',mimeType:'image/png',buffer:await readFile(new URL('../packages/apps/webapp/public/icon-192.png',import.meta.url))})
  await expect(input).toContainText('Debug screenshot.png');await expect(input).toContainText('Debug context');assert.equal(sends,0)
  await page.getByRole('button',{name:'Remove Debug screenshot.png',exact:true}).click()
  await page.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const draw=()=>{canvas.getContext('2d').fillStyle='#27ae60';canvas.getContext('2d').fillRect(0,0,32,32)};draw();const stream=canvas.captureStream(10),track=stream.getVideoTracks()[0],timer=setInterval(draw,50),stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop()};window.__screenshotTrack=track;return stream}})
  await screenshot();await expect(input).toContainText('Screenshot-');await expect.poll(()=>page.evaluate(()=>window.__screenshotTrack.readyState)).toBe('ended');assert.equal(sends,0)
  await page.getByRole('button',{name:/^Remove Screenshot-/}).click()
  await page.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException('fixture','NotAllowedError')}})
  await screenshot();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('alert')).toContainText('cancelled or blocked');assert.equal(sends,0)
  await expect(input).toHaveValue(/Debug context/)
 }finally{await browser.close()}
})
