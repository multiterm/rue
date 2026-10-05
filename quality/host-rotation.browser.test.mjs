import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const viewport of [{width:1280,height:900},{width:412,height:915}])test(`host transport rotation requires informed confirmation at ${viewport.width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport}),calls=[]
  let worker={id:'host',ownerSubject:'usr_test',name:'Mason',status:'online',desired:'active',revision:17,managedAgentCount:2,health:{capabilities:['managed-agents-v1'],acceptingWork:true}},fail=false,release
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  await page.route(`${api}/**`,async route=>{
   const request=route.request(),path=new URL(request.url()).pathname,json=(body,status=200)=>route.fulfill({status,json:body})
   if(path==='/workers')return json({workers:[worker]})
   if(path==='/workers/host'){
    const body=request.postDataJSON();calls.push(body);assert.equal(request.method(),'PATCH');assert.deepEqual(body,{action:'rotate',expectedRevision:worker.revision})
    if(fail)return json({error:'worker_revision_conflict'},409)
    await new Promise(resolve=>{release=resolve});worker={...worker,revision:18,status:'offline'};return json({worker,secret:'synthetic-transport-secret'})
   }
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[],nextCursor:null}}}}])
   if(path==='/session'||path==='/sync/preferences')return json([])
   if(path==='/terminal/computers')return json({computers:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return json({error:'not_found'},404)
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('tab',{name:'Hosts',exact:true}).click()
  const host=page.getByRole('article',{name:'Host Mason'});await host.getByText('Manage host',{exact:true}).click()
  const rotate=host.getByRole('button',{name:'Rotate transport credential',exact:true}),dialog=page.getByRole('dialog',{name:'Rotate transport credential',exact:true}),confirm=dialog.getByRole('button',{name:'Rotate and disconnect host',exact:true}),ack=dialog.getByRole('checkbox',{name:/I can update the supervisor/})
  await rotate.click();await expect(dialog).toContainText('Mason');await expect(dialog).toContainText('stops working immediately');await expect(dialog).toContainText('restart the supervisor');await expect(confirm).toBeDisabled();assert.equal(calls.length,0)
  await ack.check();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);assert.equal(calls.length,0)
  await rotate.click();await expect(ack).not.toBeChecked();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);assert.equal(calls.length,0)
  await rotate.click();await ack.check();await confirm.click();await expect.poll(()=>calls.length).toBe(1)
  await expect(dialog.getByRole('button',{name:'Rotating…',exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible()
  release();await expect(dialog).toHaveCount(0);await expect(host).toContainText('Offline');const secret=page.getByRole('dialog',{name:'Save new transport credential',exact:true});await expect(secret).toBeVisible();await expect(secret).toContainText('Step 2 of 2 · Mason');await expect(secret).toContainText('host is disconnected until');await expect(secret).toContainText('mode-0600');await expect(secret.getByLabel('Worker secret')).toHaveValue('synthetic-transport-secret');await expect(secret.getByLabel('Worker secret')).toBeFocused();assert.equal(calls.length,1)
  assert.equal(await secret.evaluate(element=>element.parentElement.parentElement===document.body),true,'Credential flow must be portaled outside the settings dialog')
  await expect(page.getByRole('region',{name:'Worker transport credential'})).toHaveCount(0)
  const done=secret.getByRole('button',{name:'Done',exact:true});await expect(done).toBeDisabled();await page.keyboard.press('Escape');await expect(secret).toBeVisible();await secret.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(secret).toBeVisible()
  await secret.getByRole('checkbox',{name:'I have saved the new credential securely.'}).check();await expect(done).toBeEnabled();await done.click();await expect(secret).toHaveCount(0);await expect(page.getByLabel('Worker secret')).toHaveCount(0);await expect(host).toBeVisible();assert.equal(calls.length,1)
  fail=true;await rotate.click();await ack.check();await confirm.click();await expect(dialog.getByRole('alert')).toContainText('Rotation may have succeeded');await expect(confirm).toBeDisabled();await expect(ack).not.toBeChecked();await expect(secret).toHaveCount(0);await expect(page.getByLabel('Worker secret')).toHaveCount(0);assert.equal(calls.length,2)
 }finally{await browser.close()}
})
