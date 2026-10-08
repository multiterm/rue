import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const viewport of [{width:1280,height:900},{width:412,height:915}])test(`Pi version, on-demand catalog and single-agent update beside microphone at ${viewport.width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
 const context=await browser.newContext({viewport}),page=await context.newPage(),agentId=randomUUID(),workerId=randomUUID(),connectionId='term_'+'a'.repeat(32),oldImage='sha256:'+'a'.repeat(64),newImage='sha256:'+'b'.repeat(64)
 await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
 const session={id:'ses_capabilities',title:'Version bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{managedAgentId:agentId},agent:'pi-terminal',terminalConnectionId:connectionId,provider:'openai',model:'test',scopes:[],directory:null,parentId:null}
 let agent={id:agentId,workerId,sessionId:session.id,connectionId,name:'Version bot',desired:'running',observed:'running',revision:1,observedRevision:1,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:true,shareThinking:true}}
 const other={...agent,id:randomUUID(),sessionId:'ses_other',connectionId:'term_'+'b'.repeat(32),name:'Other bot'},otherBefore=JSON.stringify(other)
 let serverCatalogReads=0,runtimeCatalogReads=0,inventory=true,capable=true,oldVersionKnown=true,piVersion='0.85.1',sent=0;const updates=[],hostRollouts=[]
 const catalog={truncated:false,providers:[{id:'openai',name:'OpenAI',credentialMode:'api_key',models:[{id:'test',name:'Test',contextWindow:100000}]},{id:'future-provider',name:'Future Provider',credentialMode:'api_key',models:[{id:'new-agent-model',name:'New Agent Model',contextWindow:200000}]}]}
 await page.route(`${api}/**`,route=>{
  const req=route.request(),path=new URL(req.url()).pathname,json=(body,status=200)=>route.fulfill({status,json:body}),now=Date.now()
  if(path==='/managed-agents')return json({agents:[agent,other]})
  if(path===`/managed-agents/${agentId}`&&req.method()==='PATCH'){const body=req.postDataJSON();updates.push(body);agent=body.action==='upgrade'?{...agent,revision:agent.revision+1,runtimeImage:body.image,previousRuntimeImage:oldImage,runtimeUpdateState:'updating',runtimeUpdateVersion:body.piVersion}:{...agent,config:body.config,desired:'stopped',revision:agent.revision+1};return json({agent,operation:{id:randomUUID(),status:'pending'}})}
  if(path.endsWith('/operations'))return json({operations:[]})
  if(path.endsWith('/compactions'))return json({commands:[]})
  if(path===`/runtime-rollouts/hosts/${workerId}`){if(req.method()==='POST')hostRollouts.push(req.postDataJSON());return json({rollouts:[]})}
  if(path==='/runtime-rollouts/pi-release')return json({latestVersion:'0.87.1',checkedAt:now})
  if(path==='/workers')return json({workers:[{id:workerId,ownerSubject:'usr_test',name:'Mason',managedAgentCount:3,status:'online',desired:'active',revision:14,serverNow:now,lastSeenAt:now,leaseExpiresAt:now+60000,health:{dockerAvailable:true,runtimeImage:oldImage,runtimeReleases:inventory?[...(oldVersionKnown?[{image:oldImage,piVersion:'0.85.1',createdAt:1}]:[]),{image:newImage,piVersion:'0.87.1',createdAt:2}]:[],capabilities:['managed-agents-v1',...(capable?['managed-agent-upgrade-v1']:[]),'managed-runtime-rollout-v1','managed-codex-v1','managed-dynamic-providers-v1']}}]})
  if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}])
  if(path==='/session')return json([session])
  if(path.endsWith('/messages')){if(req.method()==='POST')sent++;return json([])}
  if(path.endsWith('/parts')||path==='/sync/preferences')return json([])
  if(path===`/terminal/computers/${connectionId}/catalog`){runtimeCatalogReads++;return json({ownerSubject:'usr_test',connectionId,sessionId:session.id,piVersion,catalog,catalogHash:'c'.repeat(64),observedAt:now})}
  if(path==='/terminal/computers')return json({computers:[{id:connectionId,managedAgentId:agentId,sessionId:session.id,ownerSubject:'usr_test',name:'Version bot',revision:1,status:'online',remoteEnabled:true,serverNow:now,lastSeenAt:now,expiresAt:now+300000,relayProtocol:2,leaseExpiresAt:now+60000,runs:[],health:{pendingCount:0,agentWorking:false,uploadFailures:0,status:{version:1,piVersion,catalogHash:'c'.repeat(64),cwd:'/workspace',branch:null,state:'idle',provider:'openai',model:'test',thinking:'medium',context:{tokens:1000,window:100000,percent:1},usage:{input:0,output:0,cacheRead:0,cacheWrite:0,costUsd:0},cacheHitPercent:null,subscription:false,autoCompaction:true}}}]})
  if(path==='/provider-keys/catalog'){serverCatalogReads++;return json({providers:[],managedProviders:[]})}
  if(path==='/provider-keys')return json({ownerSubject:'usr_test',keyStorageAvailable:true,keys:[]})
  if(path==='/device/register')return json({})
  if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
  return json({error:'not_found'},404)
 })
 const open=async()=>{await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Version bot/}).click()}
 await open()
 await page.getByLabel('Workspace options').click();await expect(page.locator('.workspace-menu').getByRole('button',{name:'Search',exact:true})).toBeVisible();await page.keyboard.press('Escape')
 const update=page.locator('.composer').getByRole('button',{name:'Update agent',exact:true}),mic=page.getByRole('button',{name:'Start dictation',exact:true})
 await expect(update).toBeVisible();const u=await update.boundingBox(),m=await mic.boundingBox();assert.ok(u&&m&&Math.abs(u.y-m.y)<3&&Math.abs(m.x-(u.x+u.width))<16,'update sits directly beside microphone')
 const draft=page.locator('.chat-composer-input');await draft.fill('Keep this unsent draft')
 await update.click();const dialog=page.getByRole('dialog',{name:'Update agent',exact:true}),confirm=dialog.getByRole('button',{name:'Update this agent',exact:true})
 await expect(dialog).toContainText('0.85.1');await expect(dialog).toContainText('0.87.1');await expect(dialog).toContainText('Other agents stay running');assert.equal(updates.length,0)
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(updates.length,0)
 await update.click();await expect(confirm).toBeEnabled();await confirm.click();await expect(dialog).toContainText('manager is updating this agent')
 assert.equal(updates.length,1);assert.equal(updates[0].action,'upgrade');assert.equal(updates[0].image,newImage);assert.equal(updates[0].expectedImage,oldImage);assert.equal(updates[0].expectedRevision,1);assert.equal(updates[0].acknowledgeExecution,true)
 assert.equal(hostRollouts.length,0);assert.equal(JSON.stringify(other),otherBefore);await expect(confirm).toBeDisabled()
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(draft).toHaveValue('Keep this unsent draft');assert.equal(sent,0)
 agent={...agent,runtimeUpdateState:'updated'};piVersion='0.87.1';await open();await expect(update).toHaveCount(0)
 await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Status',exact:true}).click()
 const status=page.getByRole('region',{name:'Pi agent status',exact:true});await expect(status).toContainText('Pi version');await expect(status).toContainText('0.87.1')
 await status.getByRole('button',{name:'Edit model',exact:true}).click();const model=page.getByRole('dialog',{name:'Change provider and model',exact:true})
 await model.getByRole('combobox',{name:'Agent provider'}).click();await page.getByRole('option',{name:'Future Provider',exact:true}).click()
 await model.getByRole('combobox',{name:'Model ID'}).click();await page.getByRole('option',{name:'New Agent Model · new-agent-model',exact:true}).click()
 await model.getByRole('checkbox').check();await model.getByRole('button',{name:'Apply and stop',exact:true}).click()
 await page.getByRole('dialog',{name:'Change requested',exact:true}).getByRole('button',{name:'Done',exact:true}).click()
 assert.equal(updates[1].config.provider,'future-provider');assert.equal(updates[1].config.model,'new-agent-model');assert.equal(serverCatalogReads,0);assert.ok(runtimeCatalogReads>0)
 agent={...agent,desired:'running',runtimeImage:null,runtimeUpdateState:null};piVersion='0.85.1';inventory=false;await open();await update.click()
 await expect(dialog).toContainText('must first be prepared');await expect(confirm).toBeDisabled();await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 inventory=true;capable=false;await open();await update.click();await expect(dialog).toContainText('single-agent update support');await expect(confirm).toBeDisabled()
 capable=true;oldVersionKnown=false;piVersion=null;await open();await update.click();await expect(dialog).toContainText('Not reported');await expect(dialog).toContainText('installed version is unknown');await expect(confirm).toBeEnabled();await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
 assert.equal(updates.length,2);assert.equal(hostRollouts.length,0)
 }finally{await browser.close()}
})
