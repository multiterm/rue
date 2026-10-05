import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {chromium} from '@playwright/test'
const publicRoot=new URL('../packages/apps/webapp/public/',import.meta.url)
async function eventually(check){for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('Timed out waiting for service worker state')}
test('real Chromium push display, validation, persistent deduplication, and disable cleanup',async()=>{
 const server=createServer(async(req,res)=>{try{if(req.url==='/notifications-sw.js'){res.setHeader('Content-Type','application/javascript');res.end(await readFile(new URL('notifications-sw.js',publicRoot)))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Rue push test</title>')}}catch{res.statusCode=500;res.end()}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
 let browser
 const profile=await mkdtemp(join(tmpdir(),'rue-push-browser-'))
 try{
  browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,headless:true})
  const context=browser,page=await context.newPage(),cdp=await context.newCDPSession(page)
  await context.grantPermissions(['notifications'],{origin})
  let registrationId
  cdp.on('ServiceWorker.workerRegistrationUpdated',({registrations})=>{const row=registrations.find(row=>row.scopeURL===origin+'/');if(row)registrationId=row.registrationId})
  await cdp.send('ServiceWorker.enable');await page.goto(origin)
  const workerPromise=context.waitForEvent('serviceworker')
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/notifications-sw.js');await navigator.serviceWorker.ready})
  const worker=await workerPromise;await eventually(()=>Boolean(registrationId))
  const toggle=enabled=>page.evaluate(async enabled=>{const registration=await navigator.serviceWorker.ready;await new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=resolve;registration.active.postMessage({type:'rue-push-display',enabled},[channel.port2])})},enabled)
  const push=payload=>cdp.send('ServiceWorker.deliverPushMessage',{origin,registrationId,data:JSON.stringify(payload)})
  const displayed=()=>worker.evaluate(async()=>{const rows=await self.registration.getNotifications();return rows.map(row=>({tag:row.tag,title:row.title,body:row.body,data:row.data}))})
  await toggle(true)
  const id=randomUUID();await push({id,kind:'task_completed',sessionId:'ses_fixture'})
  await eventually(async()=>(await displayed()).length===1)
  const [notification]=await displayed();assert.equal(notification.title,'Rue agent turn completed');assert.equal(notification.data.sessionId,'ses_fixture');assert.equal(notification.tag,`rue-event-${id}`)
  // Close it, then redeliver: IDB dedupe must not re-open a dismissed alert.
  await worker.evaluate(async()=>{for(const item of await self.registration.getNotifications())item.close()})
  await push({id,kind:'task_completed',sessionId:'ses_fixture'});await new Promise(resolve=>setTimeout(resolve,400));assert.equal((await displayed()).length,0)
  await push({id:randomUUID(),kind:'task_completed',sessionId:'https://evil.example/'});await new Promise(resolve=>setTimeout(resolve,400));assert.equal((await displayed()).length,0)
  // Navigate away: the app document need not be running to display a push.
  await page.goto('about:blank');await push({id:randomUUID(),kind:'task_failed',sessionId:'ses_fixture'});await eventually(async()=>(await displayed()).length===1)
  assert.equal((await displayed())[0].title,'Rue task needs attention')
  await page.goto(origin);await toggle(false);assert.equal((await displayed()).length,0)
  await push({id:randomUUID(),kind:'test'});await new Promise(resolve=>setTimeout(resolve,400));assert.equal((await displayed()).length,0)
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true})}
})
