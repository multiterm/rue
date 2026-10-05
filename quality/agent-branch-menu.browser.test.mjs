import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])test(`Git branch header lists local branches and requests a safe switch at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session={id:'ses_branch',title:'Branch bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{},agent:'pi-terminal',terminalConnectionId:'term_branch',provider:null,model:null,scopes:[],directory:null,parentId:null}
  let repository=true,requests=[]
  await page.route(`${api}/**`,route=>{
   const path=new URL(route.request().url()).pathname,json=body=>route.fulfill({json:body}),now=Date.now()
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}])
   if(path==='/session')return json([session])
   if(path==='/terminal/computers')return json({computers:[{id:session.terminalConnectionId,sessionId:session.id,ownerSubject:session.ownerSubject,name:session.title,status:'online',remoteEnabled:true,revision:1,serverNow:now,lastSeenAt:now,expiresAt:now+120000,relayProtocol:2,leaseExpiresAt:now+60000,runs:[],health:{agentWorking:false,status:{cwd:'/workspace/repo',branch:repository?'main':null,git:repository?{branch:'main',remote:'origin',localBranches:['main','feature/test'],truncated:false}:null,state:'idle'}}}]})
   if(path==='/session/ses_branch/message'){requests.push(route.request().postDataJSON());return json({stopReason:'queued'})}
   if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path.endsWith('/queue'))return json({messages:[]})
   if(path==='/workers')return json({workers:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Branch bot/}).click()
  const button=page.getByRole('button',{name:'Git branches',exact:true}),input=page.locator('textarea.chat-composer-input')
  await expect(button).toHaveText('origin / main');await input.fill('Keep this unsent draft')
  const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width)
  await button.click();const dialog=page.getByRole('dialog',{name:'Local Git branches',exact:true})
  await expect(dialog.getByRole('button',{name:/main.*Current/})).toBeDisabled()
  await dialog.getByRole('button',{name:'feature/test',exact:true}).click();assert.equal(requests.length,0)
  await dialog.getByRole('button',{name:'Ask agent to switch',exact:true}).click();await expect(dialog).toHaveCount(0)
  assert.equal(requests.length,1);assert.match(requests[0].text,/"feature\/test"/);assert.match(requests[0].text,/Preserve all uncommitted changes/);assert.match(requests[0].text,/Do not force checkout/)
  await expect(input).toHaveValue('Keep this unsent draft');await expect(button).toHaveText('origin / main')
  repository=false;await expect(button).toHaveCount(0,{timeout:15000})
 }finally{await browser.close()}
})
