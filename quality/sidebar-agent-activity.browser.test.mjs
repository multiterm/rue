import {test} from 'node:test'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])test(`sidebar activity is animated, scoped and respects reduced motion at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  let done=false
  const sessions=['Busy bot','Compacting bot','Idle bot','Offline bot','Cloud bot'].map((title,i)=>({id:`ses_activity_${i}`,title,ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:i===4?{}:{managedAgentId:`agent_${i}`},agent:i===4?null:'pi-terminal',terminalConnectionId:i===4?null:`term_${i}`,provider:null,model:null,scopes:[],directory:null,parentId:null}))
  await page.route(`${api}/**`,route=>{
   const path=new URL(route.request().url()).pathname,json=body=>route.fulfill({json:body}),now=Date.now()
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:sessions,nextCursor:null}}}}])
   if(path==='/session')return json(sessions)
   if(path==='/terminal/computers')return json({computers:sessions.filter(s=>s.terminalConnectionId).map((s,i)=>({id:s.terminalConnectionId,sessionId:s.id,ownerSubject:s.ownerSubject,name:s.title,status:i===3?'offline':'online',remoteEnabled:true,revision:1,serverNow:now,lastSeenAt:now,expiresAt:now+120000,relayProtocol:2,leaseExpiresAt:now+60000,runs:[],health:{agentWorking:!done&&i!==2,status:{state:done?'idle':i===1?'compacting':i===2?'idle':'working'}}}))})
   if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path==='/managed-agents')return json({agents:sessions.filter(s=>s.terminalConnectionId).map((s,i)=>({id:`agent_${i}`,sessionId:s.id,connectionId:s.terminalConnectionId,workerId:'worker_mason',config:{provider:'openai'}}))})
   if(path==='/workers')return json({workers:[{id:'worker_mason',ownerSubject:'other',name:'Wrong host'},{id:'worker_mason',ownerSubject:'usr_test',name:'Mason'}]})
   if(path==='/provider-keys')return json({ownerSubject:'usr_test',keyStorageAvailable:true,keys:[{provider:'openai',configured:true,grants:sessions.filter(s=>s.terminalConnectionId).map(s=>({type:'terminal',id:s.terminalConnectionId}))}]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  const nav=page.getByRole('navigation',{name:'Sessions',exact:true}),busy=nav.getByRole('button',{name:/Busy bot/}),compacting=nav.getByRole('button',{name:/Compacting bot/})
  await expect(busy.getByLabel('Agent working',{exact:true})).toBeVisible()
  await expect(compacting.getByLabel('Agent compacting',{exact:true})).toBeVisible()
  await expect(busy.locator('.bot-execution')).toHaveText('Mason')
  await expect(nav.getByRole('button',{name:/Idle bot/}).getByLabel('Agent ready for next request',{exact:true})).toBeVisible()
  await expect(nav.getByRole('button',{name:/Offline bot/}).getByLabel('Agent status unavailable',{exact:true})).toBeVisible()
  const cloud=nav.getByRole('button',{name:/Cloud bot/})
  await expect(cloud.locator('.bot-execution')).toHaveText('Cloud')
  await expect(cloud.getByLabel('Agent ready for next request',{exact:true})).toBeVisible()
  await expect(nav.getByRole('button',{name:/Idle bot/}).locator('.sidebar-agent-activity')).toHaveCount(0)
  await expect(nav.getByRole('button',{name:/Offline bot/}).locator('.sidebar-agent-activity')).toHaveCount(0)
  const bar=busy.locator('.sidebar-activity-icon > i').first()
  await expect(bar).toHaveCSS('animation-name','sidebar-agent-working')
  await page.emulateMedia({reducedMotion:'reduce'});await expect(bar).toHaveCSS('animation-name','none')
  await expect(busy.getByLabel('Agent working',{exact:true})).toBeVisible()
  done=true;await expect(nav.locator('.sidebar-agent-activity')).toHaveCount(0,{timeout:15000})
 }finally{await browser.close()}
})
