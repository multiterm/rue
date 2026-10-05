import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const viewport of [{width:1280,height:900},{width:412,height:915}])test(`saved queue recovery requires review, preserves the conversation and survives offline status at ${viewport.width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const context=await browser.newContext({viewport}),page=await context.newPage(),connectionId='term_'+'a'.repeat(32),agentId=randomUUID(),commandId=randomUUID(),time=Date.now()-600000
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session={id:'ses_queue',title:'Queue bot',ownerSubject:'usr_test',createdAt:time,updatedAt:time,meta:{managedAgentId:agentId},agent:'pi-terminal',terminalConnectionId:connectionId,provider:'openai',model:'test',scopes:[],directory:null,parentId:null}
  const messages=[{id:'user_old',sessionId:session.id,role:'user',time,seq:0,meta:{},provider:null,model:null,agent:null},{id:'assistant_old',sessionId:session.id,role:'assistant',time,seq:1,meta:{origin:'computer'},provider:null,model:null,agent:null}]
  let parts=[{id:'user_text',sessionId:session.id,messageId:'user_old',type:'text',seq:0,payload:{text:'Saved expired request'}},{id:'assistant_text',sessionId:session.id,messageId:'assistant_old',type:'text',seq:0,payload:{text:'[Remote run expired]',remoteStatus:'expired'}}]
  const item={id:commandId,text:'Saved expired request',user_message_id:'user_old',created_at:time,updated_at:time+300001}
  let active=[],recoverable=[item],offline=false,submissions=0;const restores=[]
  await page.route(`${api}/**`,route=>{const req=route.request(),path=new URL(req.url()).pathname,json=body=>route.fulfill({json:body})
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}]);if(path==='/session')return json([session])
   if(path===`/session/${session.id}/messages`)return json(messages);if(path===`/session/${session.id}/parts`)return json(parts)
   if(path==='/terminal/computers')return json({computers:[{id:connectionId,managedAgentId:agentId,ownerSubject:'usr_test',sessionId:session.id,name:'Mason',revision:0,expiresAt:Date.now()+86400000,remoteEnabled:true,status:offline?'offline':'online',serverNow:Date.now(),lastSeenAt:Date.now()-(offline?600000:0),leaseExpiresAt:Date.now()+(offline?-540000:60000),relayProtocol:2,health:{agentWorking:false,uploadFailures:0,pendingCount:0,retries:0,lastUploadAt:Date.now(),pendingBytes:0,pollLatencyMs:0},runs:[{id:commandId,userMessageId:'user_old',status:recoverable.length?'expired':'queued',expiredBeforeDispatch:recoverable.length>0,created_at:time,updated_at:Date.now()}]}]})
   if(path===`/terminal/computers/${connectionId}/queue`)return json({messages:active,recoverableCount:recoverable.length})
   if(path===`/terminal/computers/${connectionId}/queue/recoverable`)return json({messages:recoverable})
   if(path===`/terminal/computers/${connectionId}/queue/${commandId}/requeue`){const body=req.postDataJSON();restores.push(body);assert.deepEqual(body,{expectedSessionId:session.id,acknowledgeRequeue:true});active=[{...item,status:'queued'}];recoverable=[];parts=[parts[0],{...parts[1],payload:{text:'[Waiting for computer]',remoteStatus:'queued'}}];return json({id:commandId,status:'queued',restored:true})}
   if(path.endsWith('/message')){submissions++;return json({})}
   if(path==='/sync/preferences')return json([]);if(path==='/workers')return json({workers:[]});if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Queue bot/}).click()
  await expect(page.getByRole('region',{name:'Message queue',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:/Recover expired queued requests/})).toHaveCount(0)
  await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Expired Requests',exact:true}).click()
  const panel=page.getByRole('complementary',{name:'Settings',exact:true}),list=panel.getByRole('region',{name:'Expired Requests',exact:true})
  await expect(panel.getByRole('heading',{name:'Expired Requests',exact:true})).toBeVisible()
  await panel.getByRole('button',{name:'Back to bot settings',exact:true}).click();await panel.getByRole('button',{name:'Expired Requests',exact:true}).click()
  await list.getByRole('button',{name:'Review request',exact:true}).click()
  const review=page.getByRole('dialog',{name:'Requeue saved request',exact:true}),confirm=review.getByRole('button',{name:'Requeue request',exact:true})
  await expect(confirm).toBeDisabled();assert.equal(restores.length,0)
  await review.getByRole('button',{name:'Back to expired requests',exact:true}).click();assert.equal(restores.length,0)
  await list.getByRole('button',{name:'Review request',exact:true}).click();await review.getByRole('checkbox',{name:/I want to run this saved request/}).check();await confirm.click()
  await expect(list).toContainText('Request restored');await expect(list).toContainText('No recoverable queued requests remain')
  await panel.getByRole('button',{name:'Close settings',exact:true}).click()
  await expect(page.getByRole('button',{name:/Recover expired queued requests/})).toHaveCount(0)
  await expect(page.getByRole('log',{name:'Conversation'}).getByText('Saved expired request',{exact:true})).toHaveCount(1)
  await expect(page.getByRole('region',{name:'Agent activity',exact:true})).toContainText('Queued')
  offline=true;await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Refresh',exact:true}).click()
  await expect(page.getByRole('region',{name:'Agent activity',exact:true})).toContainText('Queued requests saved')
  assert.equal(restores.length,1);assert.equal(submissions,0)
 }finally{await browser.close()}
})
