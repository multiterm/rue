import {test} from 'node:test'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const [width,outcome] of [[1280,'failure'],[412,'failure'],[412,'timeout']])test(`connection stays green during pending checks, then reports ${outcome} at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session={id:'ses_health',title:'Health bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{},agent:'pi-terminal',terminalConnectionId:'term_health',provider:null,model:null,scopes:[],directory:null,parentId:null}
  let checks=0,fail=false,release
  await page.route(`${api}/**`,async route=>{
   const path=new URL(route.request().url()).pathname,json=body=>route.fulfill({json:body})
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}])
   if(path==='/session')return json([session])
   if(path==='/terminal/computers'){
    checks++
    if(checks>1&&!fail)await new Promise(resolve=>{release=resolve})
    if(fail)return route.fulfill({status:503,json:{error:'health_check_failed'}})
    const now=Date.now()
    return json({computers:[{id:'term_health',sessionId:session.id,ownerSubject:session.ownerSubject,name:'Health bot',status:'online',remoteEnabled:true,revision:1,serverNow:now,lastSeenAt:now-25000,expiresAt:now+120000,relayProtocol:2,leaseExpiresAt:now+60000,runs:[],health:{uploadFailures:0}}]})
   }
   if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path.endsWith('/queue'))return json({commands:[]})
   if(path==='/workers')return json({workers:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Health bot/}).click()
  const controls=page.getByRole('region',{name:'Remote connection',exact:true}),dot=controls.locator('.remote-status-dot')
  await expect(controls.getByRole('button',{name:'Connection details: Connected',exact:true})).toBeVisible()
  await expect.poll(()=>checks,{timeout:15000}).toBeGreaterThan(1)
  await expect(dot).toHaveAttribute('data-state','connected')
  if(outcome==='failure'){fail=true;release()}
  await expect(controls.getByRole('button',{name:'Connection details: Health check failed',exact:true})).toBeVisible({timeout:30000})
  if(outcome==='timeout'){fail=true;release()}
  await expect(dot).toHaveAttribute('data-state','intermittent')
  await expect(controls.getByRole('button',{name:'Reconnect',exact:true})).toHaveCount(0)
 }finally{await browser.close()}
})
