import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
import {createECDH,randomBytes,randomUUID} from 'node:crypto'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const viewport of [{width:1280,height:900},{width:412,height:915}])test(`notification settings enrollment and inbox at ${viewport.width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const context=await browser.newContext({viewport,permissions:['notifications']}),page=await context.newPage()
  const curve=createECDH('prime256v1');curve.generateKeys();const publicKey=curve.getPublicKey().toString('base64url'),subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:publicKey,auth:randomBytes(16).toString('base64url')}}
  await page.addInitScript(subscription=>{let subscribed=false;Object.defineProperty(Notification,'requestPermission',{value:async()=> 'granted'});const fixture={options:{},toJSON:()=>subscription,unsubscribe:async()=>{subscribed=false;return true}};PushManager.prototype.subscribe=async()=>{subscribed=true;return fixture};PushManager.prototype.getSubscription=async()=>subscribed?fixture:null},subscription)
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{user=null;listeners.forEach(fn=>fn({authenticated:false,record:null}))},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  let enabled=false,devices=[],read=false,typedSessionReads=0;const calls=[]
  const item={id:randomUUID(),sessionId:'ses_notify',kind:'task_completed',createdAt:Date.now(),readAt:null}
  await page.route(`${api}/**`,route=>{
   const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),json=body=>route.fulfill({json:body})
   if(path==='/notifications/push'&&method==='GET')return json({enabled,publicKey:enabled?publicKey:null,devices})
   if(/^\/notifications\/push\/.+\/test$/.test(path)){calls.push('test');return json({accepted:true})}
   if(path.startsWith('/notifications/push/')&&method==='PUT'){assert.deepEqual(req.postDataJSON(),subscription);const deviceId=path.split('/').at(-1);devices=[{deviceId,expiresAt:Date.now()+86400000}];calls.push('subscribe');return json({id:randomUUID(),...devices[0]})}
   if(path.startsWith('/notifications/push/')&&method==='DELETE'){devices=[];calls.push('remove');return json({removed:true})}
   if(path==='/notifications')return json({items:[{...item,readAt:read?Date.now():null}],unread:read?0:1})
   if(path===`/notifications/${item.id}/read`){read=true;calls.push('read');return json({read:true})}
   if(path==='/session'||path==='/trpc/sessionsPage'){
    if(path==='/trpc/sessionsPage')typedSessionReads++
    const items=[{id:'ses_notify',title:'Notification bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{},agent:null,provider:null,model:null,scopes:[],directory:null,parentId:null}]
    return json(path==='/session'?items:[{result:{data:{json:{items,nextCursor:null}}}}])
   }
   if(path==='/session/ses_notify/messages'||path==='/session/ses_notify/parts'||path==='/sync/preferences')return json([])
   if(path==='/terminal/computers')return json({computers:[]})
   if(path==='/workers')return json({workers:[]})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   if(path==='/device/register')return json({})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('tab',{name:'Notifications',exact:true}).click()
  const panel=page.getByRole('tabpanel',{name:'Notifications',exact:true})
  await expect(panel.getByText(/Web Push is not configured/)).toBeVisible();await expect(panel.getByRole('button',{name:'Enable notifications on this device',exact:true})).toBeDisabled()
  // Refetch configuration without reloading the test application or granting a new account.
  enabled=true;await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.getByRole('tab',{name:'Notifications',exact:true}).click()
  await expect(panel.getByRole('button',{name:'Enable notifications on this device',exact:true})).toBeEnabled()
  await panel.getByRole('button',{name:'Enable notifications on this device',exact:true}).click()
  await expect(panel.getByRole('button',{name:'Disable notifications on this device',exact:true})).toBeVisible()
  await panel.getByRole('button',{name:'Send test notification',exact:true}).click();await expect(panel.getByRole('status')).toContainText('accepted the test')
  await panel.getByRole('button',{name:'Disable notifications on this device',exact:true}).click();await expect(panel.getByRole('button',{name:'Enable notifications on this device',exact:true})).toBeVisible()
  await panel.getByRole('button',{name:'Open',exact:true}).click();await expect(page.locator('.conversation-header')).toContainText('Notification bot');assert.deepEqual(calls,['subscribe','test','remove','read']);assert.ok(typedSessionReads>0,'The webapp must load sessions through typed tRPC')
 }finally{await browser.close()}
})
