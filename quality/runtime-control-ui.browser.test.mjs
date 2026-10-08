import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const viewport of [{width:1280,height:900},{width:412,height:915}])test(`owner runtime approval, consent, revocation and conflict handling at ${viewport.width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const context=await browser.newContext({viewport}),page=await context.newPage(),agentId=randomUUID(),workerId=randomUUID(),connectionId='term_'+'a'.repeat(32)
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session={id:'ses_approval',title:'Approval bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{managedAgentId:agentId},agent:'pi-terminal',terminalConnectionId:connectionId,provider:'openai',model:'test',scopes:[],directory:null,parentId:null}
  const agent={id:agentId,workerId,sessionId:session.id,connectionId,name:'Approval bot',desired:'running',observed:'running',revision:1,observedRevision:1,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:true,shareThinking:true}}
  let grant={ownerSubject:'usr_test',agentId,agentRevision:1,workerId,workerName:'Mason',connectionId,revision:0,enabled:false,expiresAt:null,updatedAt:null,serverNow:Date.now(),managerReady:true,audit:[]}
  const changes=[];let agentChanges=0
  await page.route(`${api}/**`,route=>{
   const req=route.request(),path=new URL(req.url()).pathname,json=(body,status=200)=>route.fulfill({status,json:body})
   if(path===`/runtime-rollouts/agents/${agentId}/grant`){
    if(req.method()==='GET')return json(grant)
    const body=req.postDataJSON();changes.push(body)
    if(body.expectedRevision!==grant.revision)return json({error:'runtime_control_revision_conflict'},409)
    assert.equal(body.expectedOwnerSubject,'usr_test')
    if(body.enabled){assert.equal(body.acknowledgeHostControl,true);assert.equal(body.expectedAgentRevision,1);assert.equal(body.expectedWorkerId,workerId);assert.equal(body.expectedConnectionId,connectionId)}
    grant={...grant,revision:grant.revision+1,enabled:body.enabled,updatedAt:Date.now(),expiresAt:body.enabled?Date.now()+body.expiresInSeconds*1000:grant.expiresAt,audit:[{action:body.enabled?'approved':'revoked',createdAt:Date.now(),rolloutId:null}]};return json(grant)
   }
   if(path==='/managed-agents')return json({agents:[agent]})
   if(path.startsWith('/managed-agents/')&&req.method()==='PATCH'){agentChanges++;return json({error:'unexpected_agent_change'},409)}
   if(path.endsWith('/operations'))return json({operations:[]})
   if(path.endsWith('/compactions'))return json({commands:[]})
   if(path==='/workers')return json({workers:[{id:workerId,ownerSubject:'usr_test',name:'Mason',status:'online',desired:'active',revision:0,health:{capabilities:['managed-agents-v1','managed-runtime-rollout-v1']}}]})
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}])
   if(path==='/session')return json([session])
   if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path==='/terminal/computers')return json({computers:[]})
   if(path==='/provider-keys')return json({ownerSubject:'usr_test',keyStorageAvailable:true,keys:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return json({error:'not_found'},404)
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Approval bot/}).click()
  await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Permissions',exact:true}).click()
  const panel=page.getByRole('region',{name:'Runtime update approval',exact:true})
  await expect(panel).toContainText('Not approved');await panel.getByRole('button',{name:'Allow runtime updates',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Allow this agent to manage runtime updates',exact:true}),approve=dialog.getByRole('button',{name:'Approve runtime updates',exact:true}),consent=dialog.getByRole('checkbox',{name:/I authorize this agent/})
  await expect(approve).toBeDisabled();assert.equal(changes.length,0)
  await consent.check();await dialog.getByRole('combobox',{name:'Approval duration'}).click();await page.getByRole('option',{name:'1 hour',exact:true}).click();await expect(approve).toBeDisabled()
  await consent.check();await approve.click();await expect(dialog).toHaveCount(0);await expect(panel).toContainText('Approved until');assert.equal(changes[0].expiresInSeconds,3600);assert.equal(agentChanges,0)
  await panel.getByRole('button',{name:'Revoke approval',exact:true}).click();await expect(panel).toContainText('Not approved');assert.equal(grant.enabled,false);assert.equal(agentChanges,0)
  await panel.getByRole('button',{name:'Allow runtime updates',exact:true}).click();grant={...grant,revision:grant.revision+1};await consent.check();await approve.click()
  await expect(dialog.getByRole('alert')).toContainText('not confirmed');await expect(approve).toBeDisabled();assert.equal(grant.enabled,false)
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(changes.length,3);assert.equal(agentChanges,0)
 }finally{await browser.close()}
})
