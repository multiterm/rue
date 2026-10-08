import {expect,test} from '@playwright/test'
import {mockSessionTrpc} from './mock-session-trpc'
const tokenRecord={token:'keyname-test-token',record:{subject:'usr_test',userEmail:'rue@example.com',principalType:'user'}}
test.beforeEach(async({page})=>{
  const sessions:Array<Record<string,unknown>>=[];const messages=new Map<string,Array<Record<string,unknown>>>();const parts=new Map<string,Array<Record<string,unknown>>>();const devices:Array<Record<string,unknown>>=[]
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:`(()=>{let user=null;let listeners=[];window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'keyname-test-token':null,signIn:async({mode})=>{window.__keynameMode=mode;if(mode==='modal'){user=${JSON.stringify(tokenRecord.record)};listeners.forEach(fn=>fn({authenticated:true,record:user}));return ${JSON.stringify(tokenRecord)}}return null},signOut:async()=>{user=null;listeners.forEach(fn=>fn({authenticated:false,record:null}))},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>listeners=listeners.filter(x=>x!==fn)},startSessionPolling(){return 0}}})()`}))
  await page.route('http://localhost:4097/**',async route=>{const request=route.request();const url=new URL(request.url());const path=url.pathname;const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});if(path.startsWith('/trpc/auth.login'))return json({result:{data:{json:{accessToken:'keyname-credential-token',subject:'usr_test',userEmail:'rue@example.com'}}}});if(path.startsWith('/trpc/auth.verifyMfa'))return json({result:{data:{json:{accessToken:'keyname-credential-token',subject:'usr_test',userEmail:'rue@example.com'}}}});if(/^\/terminal\/computers\/[^/]+\/queue$/.test(path))return json({messages:[]});if(path==='/device/register'){const input=request.postDataJSON();const row={id:input.deviceId,ownerSubject:'usr_test',name:input.name,platform:input.platform,createdAt:1,lastSeenAt:2,revokedAt:null};if(!devices.some(item=>item.id===row.id))devices.push(row);return json(row)}if(path==='/device'&&request.method()==='GET')return json(devices);if(path==='/pairing'&&request.method()==='POST')return json({id:'pair_1',token:'pair-secret',code:'12345678',expiresAt:Date.now()+300000});if(path==='/pairing/redeem'&&request.method()==='POST')return json({device:{},pairingId:'pair_1',synced:true});if(path==='/pairing/pair_1')return json({id:'pair_1',expiresAt:Date.now()+300000,claimedAt:null,claimedDeviceId:null});if(path==='/session'&&request.method()==='GET')return json(sessions);if(path==='/session'&&request.method()==='POST'){const input=request.postDataJSON();const id=`ses_${sessions.length+1}`;const session={id,title:input.title??'',agent:null,provider:'openrouter',model:'test',directory:null,scopes:[],parentId:null,ownerSubject:'usr_test',createdAt:Date.now(),updatedAt:Date.now(),meta:input.meta??{}};sessions.unshift(session);messages.set(id,[]);parts.set(id,[]);return json(session)}const sessionMatch=path.match(/^\/session\/([^/]+)$/);if(sessionMatch&&request.method()==='DELETE'){const index=sessions.findIndex(item=>item.id===sessionMatch[1]);if(index>=0)sessions.splice(index,1);messages.delete(sessionMatch[1]);parts.delete(sessionMatch[1]);return json({deleted:index>=0})}const messageMatch=path.match(/^\/session\/([^/]+)\/message$/);if(messageMatch&&request.method()==='POST'){const id=messageMatch[1];const input=request.postDataJSON();const userId='msg_user',assistantId='msg_assistant';messages.set(id,[{id:userId,sessionId:id,role:'user',time:Date.UTC(2026,8,18,12,0),provider:null,model:null,agent:null,meta:{},seq:0},{id:assistantId,sessionId:id,role:'assistant',time:Date.UTC(2026,8,18,12,0),provider:'openrouter',model:'test',agent:null,meta:{},seq:1}]);parts.set(id,[{id:'txt_user',sessionId:id,messageId:userId,type:'text',seq:0,payload:{text:input.text}},{id:'txt_assistant',sessionId:id,messageId:assistantId,type:'text',seq:0,payload:{text:'Hello from Rue'}}]);return json({userMessageId:userId,assistantMessageId:assistantId,text:'Hello from Rue',stopReason:'completed'})}const messagesMatch=path.match(/^\/session\/([^/]+)\/messages$/);if(messagesMatch)return json(messages.get(messagesMatch[1])??[]);const partsMatch=path.match(/^\/session\/([^/]+)\/parts$/);if(partsMatch)return json(parts.get(partsMatch[1])??[]);return json({error:'not_found'},404)})
  await mockSessionTrpc(page)
})
async function refreshConversation(page:import('@playwright/test').Page){await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Refresh',exact:true}).click()}
async function attachmentBot(page: import('@playwright/test').Page) {
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Create first bot' }).click()
  await page.getByLabel('Bot name').fill('Attachment bot'); await page.getByRole('button', { name: 'Add bot', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add new bot' })).toHaveCount(0)
  await expect(page.locator('.conversation-header')).toContainText('Attachment bot')
}
test('chat settings stay inside the conversation, shift wide layouts and overlay narrow layouts',async({page})=>{
 await attachmentBot(page)
 const chat=page.locator('.bot-conversation'),main=page.locator('.chat-main')
 await page.getByLabel('Workspace options').click()
 const menu=page.locator('.workspace-menu')
 await expect(menu.getByRole('separator')).toHaveCount(1)
 await expect(menu.getByRole('button')).toHaveText(['Settings','Search conversation','Connection','Routines','Refresh','Clear history','Delete bot'])
 await expect(menu.locator('button > svg')).toHaveCount(7)
 for(const mode of ['dark','light']){await page.locator('html').evaluate((node,value)=>node.setAttribute('data-mode',value),mode);expect(await menu.locator('button > svg').evaluateAll(icons=>icons.every(icon=>{const shape=icon.querySelector('path')??icon,style=getComputedStyle(shape);return style.fill==='none'&&style.stroke===getComputedStyle(icon.parentElement!).color}))).toBe(true)}
 await menu.getByRole('button',{name:'Settings',exact:true}).click()
 const panel=page.getByRole('complementary',{name:'Settings',exact:true})
 await expect(panel).toBeVisible()
 const box=await chat.boundingBox(),sheet=await panel.boundingBox()
 expect(sheet!.y).toBeGreaterThanOrEqual(box!.y);expect(sheet!.height).toBeLessThanOrEqual(box!.height)
 if(box!.width>=860){await expect(main).toHaveCSS('margin-right','360px');expect(await main.evaluate(node=>(node as HTMLElement).inert)).toBe(false)}
 await page.setViewportSize({width:600,height:800})
 await expect(chat).toHaveAttribute('data-settings-overlay','true')
 expect(await main.evaluate(node=>(node as HTMLElement).inert)).toBe(true)
 await panel.getByLabel('Bot name',{exact:true}).press('Escape')
 await expect(panel).toHaveCount(0)
 expect(await main.evaluate(node=>(node as HTMLElement).inert)).toBe(false)
 await expect(page.getByLabel('Workspace options')).toBeFocused()
})
test('bot settings pages preserve drafts and expose scoped AI and connection information',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'})
 await page.route('http://localhost:4097/agent/settings',route=>route.fulfill({json:{ownerSubject:'usr_test',harness:'pi',provider:'openai',model:'cloud-model',revision:1,apiKeyConfigured:true,keyStorageAvailable:true,models:['cloud-model'],systemPrompt:''}}))
 await page.route('http://localhost:4097/provider-keys',route=>route.fulfill({json:{ownerSubject:'usr_test',keyStorageAvailable:true,keys:[{provider:'openai',configured:true,revision:1,grants:[]}]}}))
 await attachmentBot(page);const prompts:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/message'))prompts.push(r.url())})
 await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Settings',exact:true}).click()
 const panel=page.getByRole('complementary',{name:'Settings',exact:true})
 await expect(panel.getByRole('navigation',{name:'Bot settings pages'}).getByRole('button')).toHaveText(['Routines','Connection','AI settings'])
 await expect(panel.locator('.bot-settings-page-link svg')).toHaveCount(3)
 await expect(panel.getByRole('separator')).toHaveCount(1)
 expect(await panel.getByRole('navigation',{name:'Bot settings pages'}).evaluate(nav=>nav.previousElementSibling?.tagName==='HR')).toBe(true)
 await expect(panel.getByRole('button',{name:'Routines',exact:true})).toHaveCSS('border-top-style','solid')
 await page.screenshot({path:test.info().outputPath('bot-settings-home.png'),animations:'disabled'})
 await panel.getByLabel('Bot name',{exact:true}).fill('Unsent settings draft')
 await panel.getByRole('button',{name:'Routines',exact:true}).click();await panel.getByLabel('Recurring task',{exact:true}).fill('Unscheduled draft')
 await expect(panel.getByLabel('Bot name',{exact:true})).toHaveCount(0)
 await expect(panel.locator('.bot-settings-page-content')).toHaveCSS('animation-name','rue-settings-page-enter')
 await panel.getByRole('button',{name:'Back to bot settings'}).click();await expect(panel.getByRole('button',{name:'Routines',exact:true})).toBeFocused()
 await expect(panel.getByLabel('Bot name',{exact:true})).toHaveValue('Unsent settings draft')
 await expect(panel.locator('.bot-settings-page-content')).toHaveAttribute('data-direction','back')
 await page.emulateMedia({reducedMotion:'reduce'});await expect(panel.locator('.bot-settings-page-content')).toHaveCSS('animation-name','none')
 await panel.getByRole('button',{name:'Connection',exact:true}).click();await expect(panel.getByRole('region',{name:'Connection info'})).toContainText('Rue cloud')
 await panel.getByRole('button',{name:'Back to bot settings'}).click();await panel.getByRole('button',{name:'AI settings',exact:true}).click()
 await expect(panel.getByRole('region',{name:'AI configuration'})).toContainText('cloud-model');await expect(panel).toContainText('shared across your cloud bots');await expect(panel).toContainText('Codex OAuth is separate')
 await page.screenshot({path:test.info().outputPath('bot-settings-ai.png'),animations:'disabled'})
 await panel.getByRole('button',{name:'Manage AI keys'}).click();const account=page.getByRole('dialog',{name:'Settings',exact:true});await expect(account.getByRole('tab',{name:'AI keys',exact:true})).toHaveAttribute('aria-selected','true')
 await account.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(panel.getByRole('heading',{name:'AI settings',exact:true})).toBeVisible()
 await panel.getByRole('button',{name:'Back to bot settings'}).click();await panel.getByRole('button',{name:'Routines',exact:true}).click();await expect(panel.getByLabel('Recurring task',{exact:true})).toHaveValue('Unscheduled draft');expect(prompts).toEqual([])
})
test('managed bot AI pages distinguish requested configuration and agent-specific grants',async({page})=>{
 const session={id:'ses_ai_pages',title:'Managed settings bot',ownerSubject:'usr_test',agent:'pi-terminal',provider:'openai',model:'old-model',terminalConnectionId:'term_ai_pages',meta:{managedAgentId:'managed_ai_pages'},createdAt:1,updatedAt:1}
 await page.route('http://localhost:4097/session',route=>route.fulfill({json:[session]}))
 await page.route('http://localhost:4097/managed-agents',route=>route.fulfill({json:{agents:[{id:'managed_ai_pages',sessionId:session.id,connectionId:session.terminalConnectionId,workerId:'host',name:session.title,desired:'running',observed:'running',revision:2,observedRevision:1,config:{provider:'openai',model:'requested-model',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}}]}}))
 await page.route('http://localhost:4097/provider-keys',route=>route.fulfill({json:{ownerSubject:'usr_test',keyStorageAvailable:true,keys:[{provider:'openai',configured:true,revision:1,grants:[{type:'worker',id:'host'}]}]}}))
 await page.route('http://localhost:4097/terminal/computers',route=>route.fulfill({json:{computers:[{id:session.terminalConnectionId,sessionId:session.id,ownerSubject:'usr_test',managedAgentId:'managed_ai_pages',name:'Private host',status:'offline',remoteEnabled:false,revision:1,runs:[],expiresAt:Date.now()+60000}]}}))
 let cloudReads=0;await page.route('http://localhost:4097/agent/settings',route=>{cloudReads++;return route.fulfill({status:503,json:{error:'not_expected'}})})
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Managed settings bot/}).click()
 await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Settings',exact:true}).click()
 const panel=page.getByRole('complementary',{name:'Settings',exact:true});await panel.getByRole('button',{name:'AI settings',exact:true}).click()
 await expect(panel).toContainText('requested-model');await expect(panel).toContainText('runtime may still be reconciling');await expect(panel).toContainText('Saved key · not granted to this agent');await expect(panel).not.toContainText('old-model');expect(cloudReads).toBe(0)
 await panel.getByRole('button',{name:'Back to bot settings'}).click();await panel.getByRole('button',{name:'Connection',exact:true}).click();await expect(panel).toContainText('Private host');await expect(panel).toContainText('offline');await expect(panel).toContainText('never falls back to cloud')
})
test('bot agent actions target the manager, retain uncertain request IDs and separate removal from purge',async({page})=>{
 const session={id:'ses_actions',title:'Managed actions bot',ownerSubject:'usr_test',agent:'pi-terminal',provider:'openai',model:'test-model',meta:{managedAgentId:'agent_actions'},createdAt:1,updatedAt:1}
 let agent={id:'agent_actions',sessionId:session.id,workerId:'host',name:session.title,desired:'running',observed:'running',revision:1,observedRevision:1,config:{provider:'openai',model:'test-model',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}}
 const calls:any[]=[],operations:any[]=[],results=new Map<string,any>();let historyChanges=0;let prompts=0
 await page.route('http://localhost:4097/session',route=>route.fulfill({json:[session]}))
 await page.route('http://localhost:4097/session/ses_actions/history',route=>{historyChanges++;return route.fulfill({json:{cleared:true}})})
 await page.route('http://localhost:4097/session/ses_actions/message',route=>{prompts++;return route.fulfill({status:500,json:{error:'not_expected'}})})
 await page.route('http://localhost:4097/managed-agents',route=>route.fulfill({json:{agents:[agent]}}))
 await page.route('http://localhost:4097/managed-agents/agent_actions/operations',route=>route.fulfill({json:{operations}}))
 await page.route('http://localhost:4097/managed-agents/agent_actions',route=>{
 const input=route.request().postDataJSON();expect(route.request().method()).toBe('PATCH');calls.push(input)
 if(results.has(input.requestId))return route.fulfill({json:results.get(input.requestId)})
 expect(input.expectedRevision).toBe(agent.revision);agent={...agent,revision:agent.revision+1,desired:input.action==='stop'?'stopped':input.action==='destroy'?'destroyed':'running'}
 const operation={id:input.requestId,agentId:agent.id,revision:agent.revision,action:input.action,status:'pending'};operations.unshift(operation);const result={agent,operation};results.set(input.requestId,result)
 return calls.length===1?route.fulfill({status:503,json:{error:'uncertain'}}):route.fulfill({json:result})
 })
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Managed actions bot/}).click()
 await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Settings',exact:true}).click()
 const panel=page.getByRole('complementary',{name:'Settings',exact:true});await panel.getByRole('button',{name:'Actions',exact:true}).click();await expect(panel.getByRole('heading',{name:'Agent actions'})).toBeVisible()
 await expect(panel.getByRole('button',{name:'Compact agent'})).toBeDisabled();await expect(panel).toContainText('Compact requires an updated manager/runtime')
 await panel.getByRole('button',{name:'Reload after current work'}).click();await expect(panel).toContainText('Result unconfirmed');await panel.getByRole('button',{name:'Reload after current work'}).click();await expect(panel).toContainText('Request accepted · pending');expect(calls[0]).toEqual(calls[1])
 page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Stop agent',exact:true}).click();await expect(panel.getByRole('button',{name:'Resume agent',exact:true})).toBeEnabled()
 page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Resume agent',exact:true}).click();await expect(panel.getByRole('button',{name:'Stop agent',exact:true})).toBeEnabled()
 page.once('dialog',dialog=>{expect(dialog.message()).toContain('this is not permanent purge');void dialog.accept()});await panel.getByRole('button',{name:'Remove runtime',exact:true}).click();await expect(panel).toContainText('History and workspace retained')
 expect(calls.map(call=>call.action)).toEqual(['reload','reload','stop','resume','destroy']);expect(historyChanges).toBe(0);expect(prompts).toBe(0)
 await page.screenshot({path:test.info().outputPath('bot-agent-actions.png'),animations:'disabled'})
})
test('managed actions compact through the manager, change models, update shared keys and show observed Pi status',async({page})=>{
 const now=Date.now(),session={id:'ses_controls',title:'Mason controls',ownerSubject:'usr_test',agent:'pi-terminal',provider:'openai',model:'old',terminalConnectionId:'term_controls',meta:{managedAgentId:'agent_controls'},createdAt:1,updatedAt:1}
 let agent={id:'agent_controls',sessionId:session.id,connectionId:session.terminalConnectionId,workerId:'host',name:session.title,desired:'running',observed:'running',revision:1,observedRevision:1,config:{provider:'openai',model:'old',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}}
 let stale=false;const calls:any[]=[],compactions:any[]=[]
 const keys={ownerSubject:'usr_test',keyStorageAvailable:true,keys:[{provider:'anthropic',model:'new',configured:true,revision:1,grants:[] as Array<{type:string;id:string}>}],oauth:{ownerSubject:'usr_test',provider:'openai-codex',credentialType:'oauth',configured:true,revision:1,state:'ready',expiresAt:now+60000,keyStorageAvailable:true,runtimeSupported:false,grants:[]}}
 await page.route('http://localhost:4097/session',route=>route.fulfill({json:[session]}))
 await page.route('http://localhost:4097/managed-agents',route=>route.fulfill({json:{agents:[agent]}}))
 await page.route('http://localhost:4097/managed-agents/agent_controls/operations',route=>route.fulfill({json:{operations:[]}}))
 await page.route('http://localhost:4097/managed-agents/agent_controls/compactions',route=>{
 if(route.request().method()==='POST'){const body=route.request().postDataJSON();expect(body).toMatchObject({expectedRevision:1,acknowledgeModelUse:true});calls.push({action:'compact',...body});compactions.unshift({id:body.requestId,agentId:agent.id,kind:'compact',status:'queued',revision:1});return route.fulfill({status:202,json:compactions[0]})}
 return route.fulfill({json:{commands:compactions}})
 })
 await page.route('http://localhost:4097/managed-agents/agent_controls',route=>{const body=route.request().postDataJSON();calls.push(body);agent={...agent,config:body.config,desired:'stopped',revision:2};return route.fulfill({json:{agent,operation:{status:'pending'}}})})
 await page.route('http://localhost:4097/workers',route=>route.fulfill({json:{workers:[{id:'host',ownerSubject:'usr_test',status:'online',health:{capabilities:['managed-agents-v1','managed-compact-v1']}}]}}))
 await page.route('http://localhost:4097/provider-keys/catalog',route=>route.fulfill({json:{providers:[{id:'openai',name:'OpenAI',models:[{id:'old',name:'Old'}]},{id:'anthropic',name:'Anthropic',models:[{id:'new',name:'New model'}]}]}}))
 await page.route('http://localhost:4097/provider-keys',route=>route.fulfill({json:keys}))
 await page.route('http://localhost:4097/provider-keys/anthropic/grants',route=>{expect(route.request().postDataJSON()).toEqual({expectedOwnerSubject:'usr_test',expectedRevision:1,target:{type:'terminal',id:session.terminalConnectionId},enabled:true,acknowledgeExposure:true});calls.push({action:'credential'});keys.keys[0].revision=2;keys.keys[0].grants=[{type:'terminal',id:session.terminalConnectionId}];return route.fulfill({json:keys})})
 await page.route('http://localhost:4097/provider-keys/anthropic',route=>{const body=route.request().postDataJSON();expect(body).toEqual({expectedOwnerSubject:'usr_test',expectedRevision:2,apiKey:'synthetic-key'});calls.push({action:'key'});keys.keys[0].revision=3;return route.fulfill({json:keys})})
 await page.route('http://localhost:4097/terminal/computers',route=>route.fulfill({json:{computers:[{id:session.terminalConnectionId,sessionId:session.id,ownerSubject:'usr_test',status:'online',relayProtocol:2,serverNow:Date.now(),lastSeenAt:stale?now-60000:Date.now(),leaseExpiresAt:stale?now-1:Date.now()+60000,health:{status:{version:1,cwd:'/workspace/project',branch:'develop',state:'idle',provider:'openai-codex',model:'observed-model',thinking:'medium',context:{tokens:161568,window:272000,percent:59.4},usage:{input:6500000,output:1400000,cacheRead:322000000,cacheWrite:0,costUsd:456.034},cacheHitPercent:98.7,subscription:true,autoCompaction:false}}}]}}))
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Mason controls/}).click()
 await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Actions',exact:true}).click()
 const panel=page.getByRole('complementary',{name:'Settings',exact:true});page.once('dialog',dialog=>{expect(dialog.message()).toContain('Rue chat history stays unchanged');void dialog.accept()});await panel.getByRole('button',{name:'Compact agent'}).click();await expect(panel).toContainText('Compaction · queued');expect(calls).toHaveLength(1)
 await panel.getByRole('button',{name:'Change provider / model',exact:true}).click()
 const model=page.getByRole('dialog',{name:'Change provider and model'});await model.getByRole('combobox',{name:'Agent provider'}).click();await page.getByRole('option',{name:'Anthropic',exact:true}).click();await model.getByRole('combobox',{name:'Model ID'}).click();await page.getByRole('option',{name:'New model · new',exact:true}).click();await expect(model.getByRole('button',{name:'Apply and stop'})).toBeDisabled();await model.getByRole('checkbox').check();await model.getByRole('button',{name:'Apply and stop'}).click();await expect(model).toHaveCount(0)
 expect(calls[1]).toMatchObject({action:'configure',expectedRevision:1,acknowledgeExecution:true,config:{provider:'anthropic',model:'new',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}})
 await panel.getByRole('button',{name:'Update AI key',exact:true}).click()
 const credential=page.getByRole('dialog',{name:'Update AI key',exact:true});await credential.getByRole('combobox',{name:'Saved credential'}).click();await expect(page.getByRole('option',{name:'Anthropic · API key',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('saved-agent-credentials.png'),animations:'disabled'});await page.getByRole('option',{name:'OpenAI Codex · OAuth',exact:true}).click();await expect(credential).toContainText('Update this host to an OAuth-capable runtime.');await expect(credential.getByRole('button',{name:'Use selected credential'})).toBeDisabled();await credential.getByRole('combobox',{name:'Saved credential'}).click();await page.getByRole('option',{name:'Anthropic · API key',exact:true}).click();await expect(credential.getByRole('button',{name:'Use selected credential'})).toBeDisabled();await credential.getByRole('checkbox').check();await credential.getByRole('button',{name:'Use selected credential'}).click();await expect(credential).toHaveCount(0);expect(calls[2]).toEqual({action:'credential'})
 await panel.getByRole('button',{name:'Update AI key',exact:true}).click();await expect(credential).toContainText('already shared');await credential.getByRole('button',{name:'Add or replace saved API key'}).click()
 const key=page.getByRole('dialog',{name:'Replace AI key'});await expect(key.getByRole('combobox',{name:'AI provider'})).toBeDisabled();await key.getByLabel('Anthropic API key',{exact:true}).fill('synthetic-key');await expect(key.getByRole('button',{name:'Save key'})).toBeDisabled();await key.getByRole('checkbox').check();await key.getByRole('button',{name:'Save key'}).click();await expect(key).toHaveCount(0);expect(calls[3]).toEqual({action:'key'})
 expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('synthetic-key')
 await panel.getByRole('button',{name:'Update AI key',exact:true}).click();await credential.getByRole('button',{name:'Add or replace saved API key'}).click();await expect(key).toBeVisible();await expect(key.getByLabel('Anthropic API key',{exact:true})).toHaveValue('');await expect(key.getByRole('checkbox')).not.toBeChecked();await page.keyboard.press('Escape');await expect(key).toHaveCount(0);await expect(panel).toBeVisible()
 await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Status',exact:true}).click()
 const status=panel.getByRole('region',{name:'Pi agent status'});await expect(panel.getByText('/workspace/project',{exact:true})).toBeVisible();await expect(panel).toContainText('observed-model');await expect(panel).toContainText('59.4% / 272K');await expect(panel).toContainText('$456.034 (subscription)');await expect(panel.getByRole('progressbar')).toHaveAttribute('value','59.4');await expect(panel).not.toContainText('Stale · last reported')
 stale=true;await panel.getByRole('button',{name:'Refresh status'}).click();await expect(panel).toContainText('Stale · last reported')
 const viewport=panel.locator('.rue-scroll-viewport');await expect.poll(()=>viewport.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);await viewport.evaluate(node=>node.scrollTop=0)
 await page.screenshot({path:test.info().outputPath('pi-agent-status.png'),animations:'disabled'})
})
test('managed Codex model selection and OAuth access require separate explicit consent',async({page})=>{
 const session={id:'ses_oauth_agent',title:'OAuth agent',ownerSubject:'usr_test',agent:'pi-terminal',provider:'openai',model:'old',terminalConnectionId:'term_oauth_agent',meta:{managedAgentId:'agent_oauth'},createdAt:1,updatedAt:1}
 let agent={id:'agent_oauth',sessionId:session.id,connectionId:session.terminalConnectionId,workerId:'host',name:session.title,desired:'running',observed:'running',revision:1,observedRevision:1,config:{provider:'openai',model:'old',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}}
 let oauth={ownerSubject:'usr_test',provider:'openai-codex',credentialType:'oauth',configured:true,revision:1,state:'ready',expiresAt:Date.now()+180000,keyStorageAvailable:true,runtimeSupported:true,grants:[] as Array<{type:string;id:string}>};const calls:any[]=[]
 await page.route('http://localhost:4097/session',r=>r.fulfill({json:[session]}));await page.route('http://localhost:4097/managed-agents',r=>r.fulfill({json:{agents:[agent]}}))
 await page.route('http://localhost:4097/managed-agents/agent_oauth/operations',r=>r.fulfill({json:{operations:[]}}));await page.route('http://localhost:4097/managed-agents/agent_oauth/compactions',r=>r.fulfill({json:{commands:[]}}))
 await page.route('http://localhost:4097/managed-agents/agent_oauth',r=>{const body=r.request().postDataJSON();calls.push(body);if(body.action==='configure'){expect(body).toMatchObject({expectedRevision:1,acknowledgeExecution:true,config:{provider:'openai-codex',model:'gpt-5.4',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}});agent={...agent,config:body.config,revision:2,desired:'stopped',observed:'stopped',observedRevision:2}}else{expect(body).toMatchObject({action:'resume',expectedRevision:2});agent={...agent,revision:3,desired:'running'}}return r.fulfill({json:{agent,operation:{status:'pending'}}})})
 await page.route('http://localhost:4097/workers',r=>r.fulfill({json:{workers:[{id:'host',ownerSubject:'usr_test',status:'online',health:{capabilities:['managed-agents-v1','managed-codex-v1']}}]}}))
 await page.route('http://localhost:4097/provider-keys/catalog',r=>r.fulfill({json:{providers:[{id:'openai',name:'OpenAI',models:[{id:'old',name:'Old'}]}],managedProviders:[{id:'openai',name:'OpenAI',models:[{id:'old',name:'Old'}]},{id:'openai-codex',name:'OpenAI Codex',models:[{id:'gpt-5.4',name:'GPT 5.4'}]}]}}))
 await page.route('http://localhost:4097/provider-keys',r=>r.fulfill({json:{ownerSubject:'usr_test',keyStorageAvailable:true,keys:[],oauth}}))
 await page.route('http://localhost:4097/provider-oauth/openai-codex/grants',r=>{const body=r.request().postDataJSON();expect(r.request().method()).toBe('PUT');expect(body).toEqual({expectedOwnerSubject:'usr_test',expectedRevision:1,target:{type:'terminal',id:session.terminalConnectionId},enabled:true,acknowledgeExposure:true});calls.push({action:'oauth-grant'});oauth={...oauth,revision:2,grants:[body.target]};return r.fulfill({json:oauth})})
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/OAuth agent/}).click()
 await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Actions',exact:true}).click();const panel=page.getByRole('complementary',{name:'Settings',exact:true});await panel.getByRole('button',{name:'Change provider / model',exact:true}).click()
 const model=page.getByRole('dialog',{name:'Change provider and model'});await model.getByRole('combobox',{name:'Agent provider'}).click();await page.getByRole('option',{name:'OpenAI Codex',exact:true}).click();await model.getByRole('combobox',{name:'Model ID'}).click();await page.getByRole('option',{name:'GPT 5.4 · gpt-5.4',exact:true}).click();await expect(model.getByRole('button',{name:'Apply and stop'})).toBeDisabled();await model.getByRole('checkbox').check();await model.getByRole('button',{name:'Apply and stop'}).click();await expect(model).toHaveCount(0);expect(calls).toHaveLength(1)
 await panel.getByRole('button',{name:'Update AI key',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Update AI key',exact:true});await expect(dialog.getByRole('combobox',{name:'Saved credential'})).toContainText('OpenAI Codex · OAuth');await expect(dialog).toContainText('Refresh tokens stay on the server');await expect(dialog.getByRole('button',{name:'Use selected credential'})).toBeDisabled();await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Use selected credential'}).click();await expect(dialog).toHaveCount(0);expect(calls).toHaveLength(2)
 page.once('dialog',d=>d.accept());await page.getByRole('complementary',{name:'Settings',exact:true}).getByRole('button',{name:'Resume agent'}).click();await expect.poll(()=>calls.length).toBe(3)
})
test('workspace permissions require capability and explicit consent, preserve configuration and stop without replay',async({page})=>{
 const session={id:'ses_workspace',title:'Workspace agent',ownerSubject:'usr_test',agent:'pi-terminal',terminalConnectionId:'term_workspace',meta:{managedAgentId:'agent_workspace'},createdAt:1,updatedAt:1}
 let agent:any={id:'agent_workspace',sessionId:session.id,connectionId:session.terminalConnectionId,workerId:'host',name:session.title,desired:'running',observed:'running',revision:1,observedRevision:1,config:{provider:'openai-codex',model:'gpt-5.4',permission:'coding',mounts:[],mcp:[],shareToolOutput:false,shareThinking:false}}
 let capable=false;const calls:any[]=[]
 await page.route('http://localhost:4097/session',r=>r.fulfill({json:[session]}))
 await page.route('http://localhost:4097/managed-agents',r=>r.fulfill({json:{agents:[agent]}}))
 await page.route('http://localhost:4097/managed-agents/agent_workspace/operations',r=>r.fulfill({json:{operations:[]}}))
 await page.route('http://localhost:4097/managed-agents/agent_workspace/compactions',r=>r.fulfill({json:{commands:[]}}))
 await page.route('http://localhost:4097/workers',r=>r.fulfill({json:{workers:[{id:'host',ownerSubject:'usr_test',status:'online',health:{capabilities:capable?['managed-agents-v1','managed-filesystem-v1']:['managed-agents-v1']}}]}}))
 await page.route('http://localhost:4097/managed-agents/agent_workspace',r=>{const body=r.request().postDataJSON();calls.push(body);agent={...agent,config:body.config,revision:2,desired:'stopped'};return r.fulfill({json:{agent,operation:{status:'pending'}}})})
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Workspace agent/}).click()
 await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Workspace',exact:true}).click()
 const panel=page.getByRole('complementary',{name:'Settings',exact:true})
 await expect(panel.getByLabel('Add directory',{exact:true})).toBeDisabled();await expect(panel).toContainText('Host directory access unavailable')
 capable=true;await expect(panel.getByLabel('Add directory',{exact:true})).toBeEnabled({timeout:10000})
 await panel.getByLabel('Add directory',{exact:true}).click();const directory=page.getByRole('dialog',{name:'Add directory',exact:true})
 await directory.getByLabel('Directory path').fill('/etc');await directory.getByRole('button',{name:'Add directory',exact:true}).click();await expect(directory.getByRole('alert')).toContainText('MOTHERSHIP');expect(calls).toHaveLength(0)
 await directory.getByLabel('Directory path').fill('/Volumes/MOTHERSHIP');await directory.getByRole('combobox',{name:'New directory access'}).click();await page.getByRole('option',{name:'Read and write',exact:true}).click();await directory.getByRole('button',{name:'Add directory',exact:true}).click();await expect(directory).toHaveCount(0)
 await expect(panel.getByRole('button',{name:'Apply and stop'})).toBeDisabled();await expect(panel.getByRole('checkbox',{name:'Tool output'})).toHaveCount(0)
 await panel.getByRole('checkbox',{name:/Authorize these directories/}).check();await panel.getByRole('button',{name:'Apply and stop'}).click()
 await expect.poll(()=>calls.length).toBe(1);expect(calls[0]).toMatchObject({action:'configure',expectedRevision:1,acknowledgeExecution:true,acknowledgeFilesystem:true,config:{provider:'openai-codex',model:'gpt-5.4',permission:'coding',mounts:[],mcp:[],shareToolOutput:false,shareThinking:false,filesystem:{version:1,directories:[{path:'/Volumes/MOTHERSHIP',access:'write'}]}}})
 await expect(panel).toContainText('Requested: stopped');await expect(panel.getByRole('button',{name:'Apply and stop'})).toBeDisabled();await panel.getByRole('button',{name:'Reload workspace'}).click();await expect(panel.getByRole('checkbox',{name:/Authorize these directories/})).not.toBeChecked()
 await panel.getByRole('button',{name:'Back to bot settings'}).click();await panel.getByRole('button',{name:'Permissions',exact:true}).click();await expect(panel.getByRole('tablist',{name:'Tool presets'})).toBeVisible();await expect(panel.getByRole('checkbox',{name:'Tool output',exact:true})).not.toBeChecked();await panel.getByRole('tab',{name:'Read only',exact:true}).click();await expect(panel.getByRole('checkbox',{name:'Shell, write and edit'})).not.toBeChecked();await panel.getByRole('checkbox',{name:/Authorize these permissions/}).check();await panel.getByRole('button',{name:'Apply and stop'}).click();await expect.poll(()=>calls.length).toBe(2);expect(calls[1].config.filesystem).toEqual(calls[0].config.filesystem);expect(calls[1].config.permission).toBe('read-only');expect(calls[1].acknowledgeFilesystem).toBeUndefined()
 await page.screenshot({path:test.info().outputPath('workspace-permissions.png'),animations:'disabled'})
})
test('managed history menus expose scopes and require fresh separate removal and purge consent',async({page})=>{
 const session={id:'ses_remove',title:'Removal bot',ownerSubject:'usr_test',agent:'pi-terminal',terminalConnectionId:'term_remove',meta:{managedAgentId:'agent_remove'},createdAt:1,updatedAt:1}
 let agent:any={id:'agent_remove',sessionId:session.id,workerId:'host',name:session.title,desired:'running',observed:'running',revision:1,config:{provider:'openai',model:'model',permission:'coding',mounts:[],shareToolOutput:false,shareThinking:false}}
 const calls:any[]=[]
 await page.route('http://localhost:4097/session',r=>r.fulfill({json:[session]}))
 await page.route('http://localhost:4097/managed-agents',r=>r.fulfill({json:{agents:[agent]}}))
 await page.route('http://localhost:4097/workers',r=>r.fulfill({json:{workers:[{id:'host',ownerSubject:'usr_test',health:{capabilities:['managed-purge-v1']}}]}}))
 await page.route('http://localhost:4097/managed-agents/agent_remove',r=>{const body=r.request().postDataJSON();calls.push(body);agent={...agent,desired:'destroyed',revision:agent.revision+1,...(body.action==='purge'?{purgeRequested:true}:{})};return r.fulfill({json:{agent,operation:{status:'pending'}}})})
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Removal bot/}).click()
 await page.getByLabel('Workspace options').click();const menu=page.locator('.workspace-menu');await expect(menu.getByRole('button',{name:'Clear history'})).toBeEnabled();await expect(menu.getByRole('button',{name:'Delete bot'})).toBeEnabled();await expect(menu.getByRole('button',{name:'Change provider / model'})).toHaveCount(0);await expect(menu.getByRole('button',{name:'Update AI key'})).toHaveCount(0)
 expect(await menu.getByRole('button').count()).toBe(await menu.locator('button > svg').count())
 await menu.getByRole('button',{name:'Clear history'}).click();const clear=page.getByRole('dialog',{name:'Clear history?',exact:true});await expect(clear).toContainText('Pi retains this conversation');await clear.getByRole('button',{name:'Keep history'}).click();expect(calls).toHaveLength(0)
 await page.getByLabel('Workspace options').click();await menu.getByRole('button',{name:'Delete bot'}).click();const remove=page.getByRole('dialog',{name:'Delete bot?',exact:true});await expect(remove.getByRole('button',{name:'Remove runtime',exact:true})).toBeDisabled();await remove.getByRole('checkbox').check();await remove.getByRole('button',{name:'Remove runtime',exact:true}).click();await expect(remove.getByRole('button',{name:'Purge bot and private data'})).toBeDisabled();expect(calls[0]).toMatchObject({action:'destroy',expectedRevision:1});expect(calls[0].acknowledgePurge).toBeUndefined()
 await remove.getByRole('checkbox').check();await remove.getByRole('button',{name:'Purge bot and private data'}).click();await expect(remove).toContainText('Purge pending host confirmation');expect(calls[1]).toMatchObject({action:'purge',expectedRevision:2,acknowledgePurge:true});expect(calls[0].requestId).not.toBe(calls[1].requestId)
})
test('bubble titles ellipsize on one line beside delivery status',async({page})=>{
 await page.route('http://localhost:4097/session/ses_1/messages',route=>route.fulfill({json:[{id:'long',sessionId:'ses_1',role:'assistant',seq:0,time:1,meta:{title:'A very long descriptive title '.repeat(40),remoteStatus:'completed'}}]}))
 await page.route('http://localhost:4097/session/ses_1/parts',route=>route.fulfill({json:[{id:'text',sessionId:'ses_1',messageId:'long',type:'text',seq:0,payload:{text:'Full message remains readable.',remoteStatus:'completed',mirrorFinal:true}}]}))
 await attachmentBot(page)
 const title=page.locator('.message-title'),pill=page.locator('.message-status')
 await expect(title).toHaveCSS('white-space','nowrap');await expect(title).toHaveCSS('text-overflow','ellipsis')
 expect(await title.evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true)
 const a=await title.boundingBox(),b=await pill.boundingBox();expect(a!.x+a!.width).toBeLessThanOrEqual(b!.x);expect(Math.abs(a!.y-b!.y)).toBeLessThan(6)
 await expect(page.getByText('Full message remains readable.',{exact:true})).toBeVisible()
})
test('clear history confirms its scope and preserves an unsent draft',async({page})=>{
 await attachmentBot(page);let requests=0
 await page.route('http://localhost:4097/session/ses_1/history',route=>{requests++;expect(route.request().method()).toBe('DELETE');expect(route.request().postDataJSON()).toEqual({expectedLastMessageId:null});return route.fulfill({json:{cleared:true}})})
 const draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep this draft')
 await page.getByLabel('Workspace options').click();await page.getByRole('button',{name:'Clear history',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Clear history?',exact:true});await expect(dialog).toBeVisible();expect(requests).toBe(0)
 await dialog.getByRole('button',{name:'Clear history',exact:true}).click();await expect(dialog).toHaveCount(0)
 expect(requests).toBe(1);await expect(draft).toHaveValue('Keep this draft')
})
test('managed lifecycle requires consent, retries creation idempotently and separates destruction from purge', async ({page}) => {
  const worker={id:'host',ownerSubject:'usr_test',name:'Mason',status:'online',desired:'active',managedAgentCount:0,generation:1,revision:0,health:{capabilities:['managed-agents-v1'],acceptingWork:true}}
  let agent:any,first=true;const requests:string[]=[]
  await page.route('http://localhost:4097/workers',route=>route.fulfill({json:{workers:[worker]}}))
  await page.route('http://localhost:4097/terminal/computers',route=>route.fulfill({json:{computers:[]}}))
  await page.route('http://localhost:4097/managed-agents',route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{agents:agent?[agent]:[]}})
    const input=route.request().postDataJSON();requests.push(input.requestId)
    expect(input.acknowledgeExecution).toBe(true);expect(input.config.mounts).toEqual([]);expect(input.config.permission).toBe('read-only')
    agent={...input,id:'agent',revision:1,desired:'running',observed:'running',observedRevision:1,observedGeneration:1,error:null}
    if(first){first=false;return route.fulfill({status:503,json:{error:'lost_ack'}})}
    return route.fulfill({status:201,json:{agent,operation:{}}})
  })
  await page.route('http://localhost:4097/managed-agents/agent',route=>{
    const input=route.request().postDataJSON();expect(input.expectedRevision).toBe(agent.revision)
    const desired=input.action==='stop'?'stopped':input.action==='destroy'?'destroyed':'running'
    agent={...agent,revision:agent.revision+1,observedRevision:agent.revision+1,desired,observed:desired}
    return route.fulfill({json:{agent,operation:{}}})
  })
  await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Open settings'}).click()
  await page.getByRole('tab',{name:'Agents',exact:true}).click()
  const panel=page.getByRole('region',{name:'Managed execution',exact:true})
  await panel.getByRole('button',{name:'Add new managed agent',exact:true}).click()
  const createDialog=page.getByRole('dialog',{name:'Create managed agent',exact:true}),start=createDialog.getByRole('button',{name:'Start managed agent',exact:true})
  await expect(start).toBeDisabled()
  await createDialog.getByRole('checkbox',{name:/authorize unattended prompts/}).check();await start.click()
  await expect(createDialog.getByRole('alert')).toContainText('Creation may have been accepted')
  await start.click();await expect(start).toHaveCount(0);expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1])
  await expect(panel.getByRole('table',{name:'Managed agents'})).toContainText('My managed agent')
  await panel.getByRole('searchbox',{name:'Search managed agents'}).fill('missing');await expect(panel.getByRole('table')).toContainText('No rows match');await panel.getByRole('searchbox',{name:'Search managed agents'}).fill('')
  await expect(page.getByRole('table',{name:'Linked agents'})).toBeVisible()
  await expect(page).toHaveScreenshot('rue-settings-agents.png',{animations:'disabled',fullPage:true})
  await panel.getByRole('button',{name:'Manage My managed agent',exact:true}).click()
  const card=page.getByRole('article',{name:'Managed agent My managed agent'})
  page.on('dialog',dialog=>dialog.accept())
  await card.getByRole('button',{name:'Stop agent',exact:true}).click()
  await expect(card.getByRole('button',{name:'Reload after current work'})).toBeDisabled()
  await card.getByRole('button',{name:'Resume agent',exact:true}).click()
  await expect(card).toContainText('Desired: running')
  await card.getByRole('button',{name:'Destroy runtime',exact:true}).click()
  await expect(card).toContainText('History and workspace volumes are retained')
  await expect(card.getByRole('button',{name:'Resume agent',exact:true})).toHaveCount(0)
})

test('MCP credentials stay ephemeral and managed selection requires coding consent',async({page})=>{
  let profile:any,agent:any
  await page.route('http://localhost:4097/mcp**',route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{ownerSubject:'usr_test',profiles:profile?[profile]:[]}})
    const input=route.request().postDataJSON();expect(input.expectedOwnerSubject).toBe('usr_test');expect(input.environment).toEqual({EXAMPLE:'synthetic-ui-secret'})
    profile={id:new URL(route.request().url()).pathname.split('/').at(-1),name:input.name,transport:'stdio',command:input.command,args:input.args,environmentNames:['EXAMPLE'],revision:1,createdAt:1,revokedAt:null}
    return route.fulfill({status:201,json:{profile}})
  })
  await page.route('http://localhost:4097/workers',route=>route.fulfill({json:{workers:[{id:'host',ownerSubject:'usr_test',name:'Mason',status:'online',health:{capabilities:['managed-agents-v1','managed-mcp-v1']}}]}}))
  await page.route('http://localhost:4097/terminal/computers',route=>route.fulfill({json:{computers:[]}}))
  await page.route('http://localhost:4097/managed-agents',route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{agents:agent?[agent]:[]}})
    const input=route.request().postDataJSON();expect(input.config.mcp).toEqual([profile.id]);expect(input.config.permission).toBe('coding')
    agent={...input,id:'agent',desired:'running',observed:'starting',revision:1,observedRevision:1,observedGeneration:1}
    return route.fulfill({status:201,json:{agent,operation:{}}})
  })
  await page.route('http://localhost:4097/managed-agents/agent',route=>{
    const input=route.request().postDataJSON();expect(input.action).toBe('configure');expect(input.acknowledgeExecution).toBe(true);expect(input.config.mcp).toEqual([])
    agent={...agent,config:input.config,revision:2,observedRevision:2,desired:'stopped',observed:'stopped'}
    return route.fulfill({json:{agent,operation:{}}})
  })
  await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Open settings'}).click()
  await page.getByRole('tab',{name:'MCP',exact:true}).click()
  await page.getByRole('button',{name:'Add new MCP connection',exact:true}).click()
  await page.getByLabel('MCP connection name').fill('Canary tools');await page.getByLabel('Arguments (JSON array)').fill('["server.mjs"]')
  const secret=page.getByLabel('Secret environment (JSON object)');await expect(secret).toHaveAttribute('type','password');await secret.fill('{"EXAMPLE":"synthetic-ui-secret"}')
  await expect(page.getByRole('button',{name:'Save MCP connection'})).toBeDisabled()
  await page.getByRole('checkbox',{name:/I trust this MCP program/}).check();await page.getByRole('button',{name:'Save MCP connection'}).click()
  await expect(secret).toHaveCount(0);await expect(page.getByRole('article',{name:'MCP connection Canary tools'})).toContainText('1 protected environment values')
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('synthetic-ui-secret')
  await page.getByRole('tab',{name:'Agents',exact:true}).click();await page.getByRole('button',{name:'Add new managed agent',exact:true}).click()
  const selection=page.getByRole('checkbox',{name:'Use Canary tools'});await expect(selection).toBeDisabled()
  await page.getByRole('combobox',{name:'Tool permissions'}).click();await page.getByRole('option',{name:'Coding: bash, edit and write'}).click()
  await selection.check();await expect(page.getByRole('button',{name:'Start managed agent'})).toBeDisabled()
  await page.getByRole('checkbox',{name:/authorize unattended prompts/}).check();await page.getByRole('button',{name:'Start managed agent'}).click()
  await page.getByRole('button',{name:'Manage My managed agent',exact:true}).click()
  const card=page.getByRole('article',{name:'Managed agent My managed agent'})
  await expect(card).toContainText('1 MCP connections')
  await card.getByRole('button',{name:'Configure tools and MCP'}).click()
  await card.getByRole('checkbox',{name:'Use Canary tools'}).uncheck()
  await expect(card.getByRole('button',{name:'Save configuration and stop'})).toBeDisabled()
  await card.getByRole('checkbox',{name:/authorize these tool permissions/}).check()
  await card.getByRole('button',{name:'Save configuration and stop'}).click()
  await expect(card).toContainText('Desired: stopped');await expect(card).not.toContainText('1 MCP connections')
})

test('host settings no longer expose project-key binding controls',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('tab',{name:'Hosts',exact:true}).click()
 await expect(page.getByRole('button',{name:'Add project binding'})).toHaveCount(0);await expect(page.getByLabel('Tenancy project key')).toHaveCount(0)
})

test('healthy push sync reconciles missed replies without refresh and restores fast polling after stream loss', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (String(input).endsWith('/event')) {
        if ((window as any).__streamDown) return Promise.reject(new TypeError('offline'))
        return Promise.resolve(new Response(new ReadableStream({ start(controller) { (window as any).__events = controller } }), { headers: { 'content-type': 'text/event-stream' } }))
      }
      return original(input, init)
    }
  })
  let computers = 0, queue = 0, parts = 0, completed = false
  await page.route('http://localhost:4097/session/push/messages', route => route.fulfill({json:completed?[{id:'missed-reply',sessionId:'push',role:'assistant',seq:1,time:1,meta:{origin:'computer'}}]:[]}))
  await page.route('http://localhost:4097/session', route => route.fulfill({ json: [{ id: 'push', title: 'Push bot', agent: 'pi-terminal', ownerSubject: 'usr_test', meta: {}, createdAt: 1, updatedAt: 1 }] }))
  await page.route('http://localhost:4097/terminal/computers', route => { computers++; return route.fulfill({ json: { computers: [{ id: 'push_host', sessionId: 'push', ownerSubject: 'usr_test', name: 'Laptop', status: 'online', remoteEnabled: true, lastSeenAt: Date.now() }] } }) })
  await page.route('http://localhost:4097/terminal/computers/push_host/queue', route => { queue++; return route.fulfill({ json: { messages: [] } }) })
  await page.route('http://localhost:4097/session/push/parts', route => { parts++; return route.fulfill({ json: completed?[{id:'missed-part',sessionId:'push',messageId:'missed-reply',type:'text',seq:0,payload:{text:'Reply recovered without resending',remoteStatus:'completed',mirrorFinal:true}}]:[] }) })
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('navigation', { name: 'Sessions' }).getByRole('button', { name: /Push bot/ }).click()
  await expect(page.getByText('Send a message to start the conversation.')).toBeVisible()
  await expect.poll(() => queue).toBeGreaterThan(0)
  // Observe across the old 2–3 second poll intervals, not just one render.
  await page.waitForTimeout(300)
  const baseline = { computers, queue, parts }
  await page.waitForTimeout(3300)
  expect({ computers, queue, parts }).toEqual(baseline)
  await page.evaluate(() => (window as any).__events.enqueue(new TextEncoder().encode('data: {"id":1,"type":"part.updated","time":1,"payload":{"sessionId":"push"}}\n\n')))
  await expect.poll(() => parts).toBeGreaterThan(baseline.parts)
  // Persist a reply without emitting its event. Heartbeats keep SSE healthy.
  completed = true
  await page.evaluate(() => (window as any).__events.enqueue(new TextEncoder().encode(': heartbeat\n\n')))
  await expect(page.getByText('Reply recovered without resending')).toBeVisible({timeout:15000})
  await page.evaluate(() => { (window as any).__streamDown = true; (window as any).__events.close() })
  await expect.poll(() => computers).toBeGreaterThan(baseline.computers)
})

test('live transcript frames render immediately and manual agent sync never sends a prompt',async({page})=>{
 await page.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=(input,init)=>String(input).endsWith('/event')?Promise.resolve(new Response(new ReadableStream({start(controller){(window as any).__syncEvents=controller}}),{headers:{'content-type':'text/event-stream'}})):original(input,init)})
 let reads=0,syncs=0,prompts=0,seen=Date.now()-1000
 const session={id:'ses_live',title:'Live agent',ownerSubject:'usr_test',agent:'pi-terminal',meta:{},createdAt:1,updatedAt:1}
 const message={id:'live-reply',sessionId:session.id,role:'assistant',seq:1,time:1,meta:{origin:'computer'}}
 const part={id:'live-part',sessionId:session.id,messageId:message.id,type:'text',seq:0,payload:{text:'Instant shared reply',mirrorVersion:1,mirrorFinal:true,remoteStatus:'completed'}}
 await page.route('http://localhost:4097/session',r=>r.fulfill({json:[session]}))
 await page.route('http://localhost:4097/session/ses_live/messages',r=>{reads++;return r.fulfill({json:syncs?[message]:[]})})
 await page.route('http://localhost:4097/session/ses_live/parts',r=>{reads++;return r.fulfill({json:syncs?[part]:[]})})
 await page.route('http://localhost:4097/session/ses_live/message',r=>{prompts++;return r.fulfill({status:500,json:{error:'must_not_send'}})})
 await page.route('http://localhost:4097/terminal/computers',r=>r.fulfill({json:{computers:[{id:'term_live',sessionId:session.id,ownerSubject:'usr_test',status:'online',relayProtocol:2,serverNow:Date.now(),lastSeenAt:seen,leaseExpiresAt:Date.now()+60000,health:{agentWorking:false,pendingCount:0,uploadFailures:0}}]}}))
 await page.route('http://localhost:4097/terminal/computers/term_live/queue',r=>r.fulfill({json:{messages:[]}}))
 await page.route('http://localhost:4097/terminal/computers/term_live/sync',r=>{expect(r.request().postDataJSON()).toEqual({expectedSessionId:session.id});syncs++;seen=Date.now();return r.fulfill({json:{requestedAt:seen,agentOnline:true,sessionId:session.id}})})
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Live agent/}).click()
 await expect(page.getByText('Send a message to start the conversation.')).toBeVisible();await page.waitForTimeout(250);const before=reads
 await page.evaluate(({sessionId,message,part})=>(window as any).__syncEvents.enqueue(new TextEncoder().encode('data: '+JSON.stringify({id:1,type:'part.updated',time:1,payload:{sessionId,upsert:{message,parts:[part]}}})+'\n\n')),{sessionId:session.id,message,part})
 await expect(page.getByText('Instant shared reply',{exact:true})).toBeVisible({timeout:1000});expect(reads).toBe(before)
 await expect(page.locator('.message-column .agent-sync')).toHaveCount(0);await page.getByLabel('Workspace options').click();await page.getByRole('button',{name:'Sync conversation',exact:true}).click();await expect(page.getByText('Shared updates checked. No pending uploads reported.')).toBeVisible()
 expect(syncs).toBe(1);expect(prompts).toBe(0);await expect(page.locator('.workspace-menu').getByRole('button',{name:'Sync conversation'}).locator('svg')).toHaveCount(1)
})
test('remote working bubble scrolls with the thread, follows queue changes, and is isolated by bot', async ({ page }) => {
  let working = true, running = false, fail = false, compacting = false
  const sessions = [{ id: 'remote_work', title: 'Working remote', agent: 'pi-terminal', ownerSubject: 'usr_test', meta: {}, createdAt: 1, updatedAt: 1 }, { id: 'cloud_work', title: 'Idle cloud', agent: 'pi', ownerSubject: 'usr_test', meta: {}, createdAt: 1, updatedAt: 1 }]
  await page.route('http://localhost:4097/session', route => route.fulfill({ json: sessions }))
  await page.route('http://localhost:4097/terminal/computers', route => fail ? route.fulfill({ status: 503, json: { error: 'offline' } }) : route.fulfill({ json: { computers: [{ id: 'working_computer', sessionId: 'remote_work', ownerSubject: 'usr_test', name: 'Laptop', status: 'online', remoteEnabled: true, lastSeenAt: Date.now(), health: { agentWorking: working, status: { state: compacting ? 'compacting' : working ? 'working' : 'idle' } } }] } }))
  await page.route('http://localhost:4097/terminal/computers/working_computer/queue', route => route.fulfill({ json: { messages: running ? [{ id: 'run', text: 'Queued task', status: 'running' }] : [] } }))
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  const select = async (name: string) => {
    if (test.info().project.name === 'mobile' && await page.getByRole('button', { name: 'Open bot menu' }).isVisible()) await page.getByRole('button', { name: 'Open bot menu' }).click()
    await page.getByRole('navigation', { name: 'Sessions' }).getByRole('button', { name: new RegExp(name) }).click()
  }
  await select('Working remote')
  const activity = page.getByRole('region', { name: 'Agent activity' })
  await expect(activity).toContainText('Working…')
  await expect(activity).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(activity.locator('.agent-working-label')).toHaveCSS('font-size','14px');await expect(activity.locator('.agent-working-bubble')).toHaveCount(0)
  const viewport = page.locator('.chat-scroll-viewport')
  await viewport.evaluate(el => { const filler = document.createElement('div'); filler.style.height = '2400px'; el.querySelector('.message-column')!.prepend(filler) })
  await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
  await viewport.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
  await expect(page.getByRole('button', { name: 'Latest messages' })).toBeVisible()
  await expect(viewport.locator('.agent-working-bar')).toHaveCount(1)
  await expect(activity).not.toBeInViewport()
  await page.getByRole('button', { name: 'Latest messages' }).click()
  await expect(activity).toBeInViewport()
  await expect(page.locator('.message-column > :last-child')).toHaveClass('agent-working-bar')
  await select('Idle cloud'); await expect(activity).toHaveCount(0)
  await select('Working remote'); await expect(activity).toContainText('Working…')
  running = true
  await expect(page.getByRole('region', { name: 'Message queue', exact: true })).toHaveCount(0)
  working = false
  await refreshConversation(page)
  await expect(activity).toContainText('Working…')
  fail = true; await refreshConversation(page)
  await expect(activity).toContainText('Checking agent status…')
  fail = false; running = false
  await refreshConversation(page)
  await expect(activity).toHaveCount(0)
  compacting = true; await refreshConversation(page)
  await expect(activity).toContainText('Compacting…')
  await expect(activity.locator('.working-avatar')).toHaveClass(/is-active/)
  fail = true; await refreshConversation(page)
  await expect(activity).not.toContainText('Compacting…')
  fail = false; compacting = false; await refreshConversation(page)
  await expect(activity).toHaveCount(0)
})

test('cloud working bubble appears in the thread until the request finishes', async ({ page }) => {
  await attachmentBot(page)
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  await page.route('http://localhost:4097/session/*/message', async route => { await pending; await route.fulfill({ json: { text: 'Done', stopReason: 'completed' } }) })
  try {
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A task')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    const activity = page.getByRole('region', { name: 'Agent activity' })
    await expect(activity).toContainText('Working…')
    await expect(page.locator('.chat-scroll-viewport .agent-working-bar')).toHaveCount(1)
    finish(); await expect(activity).toHaveCount(0)
  } finally { finish() }
})

test('appearance separates system mode from palette and follows OS changes',async({page})=>{
 let appearance={key:'appearance',value:{theme:'Rue',mode:'light'},version:1,updatedAt:1,updatedByDevice:null}
 await page.route('http://localhost:4097/sync/preferences',r=>r.fulfill({json:[appearance]}))
 await page.route('http://localhost:4097/sync/preferences/appearance',r=>{appearance={...appearance,value:r.request().postDataJSON().value};return r.fulfill({json:appearance})})
 await attachmentBot(page);await page.getByRole('button',{name:'Open settings',exact:true}).click()
 const panel=page.getByRole('tabpanel',{name:'Appearance',exact:true})
 await expect(panel.getByRole('group',{name:'Palettes'}).getByRole('button')).toHaveCount(7)
 await panel.getByRole('button',{name:'Ocean palette'}).click();await expect.poll(()=>appearance.value.theme).toBe('Ocean')
 await panel.getByRole('tab',{name:'System',exact:true}).click();await expect.poll(()=>appearance.value.mode).toBe('system')
 await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-mode','dark')
 await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-mode','light')
 await expect(panel.getByRole('button',{name:'Ocean palette'})).toHaveAttribute('aria-pressed','true');expect(appearance.value.mode).toBe('system')
 await expect(panel.locator('.settings-page-heading p')).toHaveText('Choose your theme and accent palette.')
})
test('dashboard controls stay separate from the sticky agent header', async ({ page }) => {
  let appearance = { key: 'appearance', value: { theme: 'Rue', mode: 'light' }, version: 1, updatedAt: 1, updatedByDevice: null }
  await page.route('http://localhost:4097/sync/preferences', route => route.fulfill({ json: [appearance] }))
  await page.route('http://localhost:4097/sync/preferences/appearance', route => {
    appearance = { ...appearance, value: route.request().postDataJSON().value, version: appearance.version + 1 }
    return route.fulfill({ json: appearance })
  })
  await attachmentBot(page)
  const top = page.locator('.dashboard-header'), chat = page.locator('.conversation-header')
  await expect(top).not.toContainText('Attachment bot')
  await expect(top.getByLabel('Workspace options')).toHaveCount(0)
  await expect(chat).toContainText('Attachment bot')
  await expect(chat).toContainText('Cloud · Rue server')
  await expect(chat.getByLabel('Workspace options')).toBeVisible()
  const before = (await chat.boundingBox())!
  expect(before.y).toBeGreaterThanOrEqual((await top.boundingBox())!.height)
  await page.locator('.chat-scroll-viewport').evaluate(el => { const filler = document.createElement('div'); filler.style.height = '2400px'; el.firstElementChild!.append(filler); el.scrollTop = 1000 })
  expect((await chat.boundingBox())!.y).toBe(before.y)
  expect((await top.boundingBox())!.y).toBe(0)
  if (test.info().project.name === 'mobile') {
    await expect(top.getByRole('button', { name: /Switch to .* mode/ })).toBeHidden()
    await expect(top).toContainText('Rue')
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep my draft')
    await top.getByRole('button', { name: 'Open bot menu' }).click()
    await expect(page.getByRole('navigation', { name: 'Sessions' })).toBeVisible()
    await top.getByRole('button', { name: 'Close bot menu' }).click()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep my draft')
  } else {
    await top.getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect(top.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()
    await expect.poll(() => appearance.value.mode).toBe('dark')
  }
  await top.getByRole('button', { name: 'Open settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: test.info().project.name === 'mobile' ? 'Dark' : 'Light', exact: true }).click()
  if (test.info().project.name !== 'mobile') await expect(top.getByRole('button', { name: 'Switch to dark mode' })).toBeAttached()
})

test('delayed data uses skeletons instead of flashing empty states and respects reduced motion', async ({ page }) => {
  let sessionsReady!: () => void, partsReady!: () => void, settingsReady!: () => void, computersReady!: () => void
  const sessionsGate = new Promise<void>(r => { sessionsReady = r }), partsGate = new Promise<void>(r => { partsReady = r })
  const settingsGate = new Promise<void>(r => { settingsReady = r }), computersGate = new Promise<void>(r => { computersReady = r })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('http://localhost:4097/session', async route => { await sessionsGate; await route.fulfill({ json: [{ id: 'slow', title: 'Slow bot', ownerSubject: 'usr_test', meta: {}, createdAt: 1, updatedAt: 1 }] }) })
  await page.route('http://localhost:4097/session/slow/parts', async route => { await partsGate; await route.fulfill({ json: [] }) })
  await page.route('http://localhost:4097/agent/settings', async route => { await settingsGate; await route.fulfill({ status: 503, json: { error: 'unavailable' } }) })
  await page.route('http://localhost:4097/terminal/computers', async route => { await computersGate; await route.fulfill({ json: { computers: [] } }) })
  try {
    await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
    const loading = page.getByRole('status', { name: 'Loading bots', exact: true })
    await expect(loading).toBeVisible()
    await expect(page.getByText('Your Rue crew starts here.')).toHaveCount(0)
    expect(await loading.locator('.rue-skeleton').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none')
    sessionsReady()
    await page.getByRole('navigation', { name: 'Sessions' }).getByRole('button', { name: /Slow bot/ }).click()
    await expect(page.getByRole('status', { name: 'Loading conversation' })).toBeVisible()
    await expect(page.getByText('Send a message to start the conversation.')).toHaveCount(0)
    partsReady()
    await expect(page.getByRole('status', { name: 'Loading conversation' })).toHaveCount(0)
    await expect(page.getByText('Send a message to start the conversation.')).toBeVisible()
    await page.getByRole('button', { name: 'Open settings' }).click()
    await page.getByRole('tab', { name: 'Models', exact: true }).click()
    await expect(page.getByRole('status', { name: 'Loading agent settings', exact: true })).toBeVisible()
    settingsReady()
    await expect(page.getByText('Model settings unavailable. Try again.')).toBeVisible()
    await page.getByRole('tab', { name: 'Agents', exact: true }).click()
    await expect(page.getByRole('status', { name: 'Loading linked agents', exact: true })).toBeVisible()
    computersReady()
    await expect(page.getByRole('status', { name: 'Loading linked agents', exact: true })).toHaveCount(0)
  } finally { sessionsReady(); partsReady(); settingsReady(); computersReady() }
})

for (const attached of [false, true]) test(`composer newline and send keys work with ${attached ? 'inline attachments' : 'plain text'} on touch and desktop`, async ({ page }) => {
  await attachmentBot(page)
  const touch = test.info().project.name === 'mobile'
  expect(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches)).toBe(touch)
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  let sent = 0; page.on('request', request => { if (request.url().endsWith('/message') && request.method() === 'POST') sent++ })
  await draft.fill('First line')
  if (attached) {
    await page.getByLabel('Attach files', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') })
    await expect(draft).toContainText('notes.txt')
  }
  await expect(draft).toHaveAttribute('enterkeyhint', 'enter')
  await draft.press('End')
  await draft.press(touch ? 'Enter' : 'Shift+Enter')
  await page.keyboard.insertText('Second line')
  if (!attached) await expect(draft).toHaveValue('First line\nSecond line')
  else await expect(draft).toContainText('Second line')
  expect(sent).toBe(0)
  const request = page.waitForRequest(request => request.url().endsWith('/message') && request.method() === 'POST')
  if (touch) await page.getByRole('button', { name: 'Send message' }).click()
  else await draft.press('Enter')
  const body = (await request).postDataJSON()
  expect(body.text).toContain('\nSecond line')
  if (attached) expect(body.content.at(-1).text).toContain('\nSecond line')
  expect(sent).toBe(1)
})

test('attachments: plus inserts inline, typing continues after the file, and ordered content is sent', async ({ page }) => {
  await attachmentBot(page)
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill('Before After'); await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(7, 7))
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add photos & files' }).click()
  await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Evidence') })
  await expect(input).toContainText('notes.txt')
  await page.keyboard.insertText('continued ')
  await expect(input).toContainText('continued After')
  const request = page.waitForRequest(r => r.url().endsWith('/message') && r.method() === 'POST')
  await page.getByRole('button', { name: 'Send message' }).click()
  const body = (await request).postDataJSON()
  expect(body.content).toEqual([{ type: 'text', text: 'Before ' }, { type: 'file', name: 'notes.txt', mimeType: 'text/plain', data: Buffer.from('Evidence').toString('base64') }, { type: 'text', text: ' continued After' }])
  await expect(page.locator('textarea[aria-label="Message"]')).toHaveValue('')
})
test('attachments: paste and drop support mixed files; remove and failed-send drafts are preserved', async ({ page }) => {
  await attachmentBot(page)
  await page.route('http://localhost:4097/session/*/message', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline"}' }))
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill('Keep this ')
  await input.evaluate(el => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['video bytes'], 'clip.mp4', { type: 'video/mp4' }))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(input).toContainText('clip.mp4')
  await input.evaluate(el => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['image bytes'], 'screen.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
  })
  await expect(input).toContainText('screen.png')
  await page.getByRole('button', { name: 'Remove clip.mp4' }).click()
  await expect(input).not.toContainText('clip.mp4')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText(/Message not completed/)).toBeVisible()
  await expect(input).toContainText('Keep this')
  await expect(input).toContainText('screen.png')
  await page.getByRole('button', { name: 'Remove screen.png' }).click()
  await expect(input).toHaveValue(/Keep this/)
})
test('empty conversation is styled and composer placeholder never overlaps a draft',async({page})=>{
 await attachmentBot(page)
 const empty=page.locator('.empty-chat'),input=page.getByRole('textbox',{name:'Message',exact:true})
 await expect(empty.getByRole('heading',{name:'Chat with Attachment bot'})).toBeVisible()
 await expect(empty).toHaveCSS('text-align','center')
 await expect(empty.locator('.bot-avatar')).toBeVisible()
 await expect(page.getByText('Bot created. The managed runtime may still be starting.')).toHaveCount(0)
 await expect(input).toHaveCount(1);await expect(input).toHaveAttribute('placeholder','Message Attachment bot')
 await empty.screenshot({path:test.info().outputPath('empty-conversation.png')})
 await input.pressSequentially('A draft for this bot')
 await expect(input).toHaveValue('A draft for this bot');await expect(input).not.toHaveAttribute('placeholder',/./)
 await page.locator('.composer').screenshot({path:test.info().outputPath('composer-typed.png')})
 await input.fill('Line one\nLine two\nLine three\nLine four')
 await expect(input).not.toHaveAttribute('placeholder',/./)
 await expect.poll(async()=>Math.round((await input.boundingBox())!.height)).toBeGreaterThan(44)
 await input.fill('');await expect(input).toHaveAttribute('placeholder','Message Attachment bot')
 await input.fill('Retained draft')
 await page.getByRole('button',{name:'Chat actions',exact:true}).click();await page.getByRole('button',{name:'New bot',exact:true}).click()
 await page.getByLabel('Bot name').fill('Another bot');await page.getByRole('button',{name:'Add bot',exact:true}).click()
 await expect(input).toHaveValue('');await expect(input).toHaveAttribute('placeholder','Message Another bot')
 if(test.info().project.name==='mobile')await page.getByRole('button',{name:'Open bot menu'}).click()
 await page.getByLabel('Sessions').getByRole('button',{name:/Attachment bot/}).click()
 await expect(input).toHaveValue('Retained draft');await expect(input).not.toHaveAttribute('placeholder',/./)
})
test('attachments: drafts stay with their bot when switching conversations', async ({ page }) => {
  await attachmentBot(page)
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill('Original ')
  await page.getByLabel('Attach files', { exact: true }).setInputFiles({ name: 'private.txt', mimeType: 'text/plain', buffer: Buffer.from('first bot only') })
  await expect(input).toContainText('private.txt')
  await page.getByRole('button',{name:'Chat actions',exact:true}).click(); await page.getByRole('button', { name: 'New bot', exact: true }).click()
  await page.getByLabel('Bot name').fill('Second bot'); await page.getByRole('button', { name: 'Add bot', exact: true }).click()
  await expect(page.locator('textarea[aria-label="Message"]')).toHaveValue('')
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Open bot menu' }).click()
  await page.getByLabel('Sessions').getByRole('button', { name: /Attachment bot/ }).click()
  await expect(input).toContainText('Original')
  await expect(input).toContainText('private.txt')
})
test('attachments: screenshot captures one frame, ends the stream, and remains an unsent draft', async ({ page }) => {
  await attachmentBot(page)
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32
    canvas.getContext('2d')!.fillRect(0, 0, 32, 32)
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      const stream = canvas.captureStream(10)
      const track = stream.getVideoTracks()[0]!
      ;(window as any).__screenshotTrack = track
      const timer = setInterval(() => canvas.getContext('2d')!.fillRect(0, 0, 32, 32), 50)
      const stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop() }
      return stream
    } })
  })
  let sent = false; page.on('request', request => { if (request.url().endsWith('/message')) sent = true })
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
  await page.getByRole('button', { name: 'Take screenshot' }).click()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toContainText('Screenshot-')
  await expect.poll(() => page.evaluate(() => (window as any).__screenshotTrack.readyState)).toBe('ended')
  expect(sent).toBe(false)
})
test('attachments: sent image downloads are authenticated and render as private blob previews', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=', 'base64')
  await page.route('http://localhost:4097/session/*/messages', route => route.fulfill({ json: [{ id: 'msg_file', sessionId: 'ses_1', role: 'user', time: Date.now(), seq: 0, meta: {} }] }))
  await page.route('http://localhost:4097/session/*/parts', route => route.fulfill({ json: [{ id: 'file_1', sessionId: 'ses_1', messageId: 'msg_file', type: 'file', seq: 0, payload: { name: 'private.png', mimeType: 'image/png', size: png.length } }] }))
  let authorized = false
  await page.route('http://localhost:4097/session/ses_1/attachments/file_1', route => { authorized = route.request().headers().authorization === 'Bearer keyname-test-token'; return route.fulfill({ contentType: 'application/octet-stream', body: png }) })
  await attachmentBot(page)
  await expect(page.getByAltText('private.png')).toHaveAttribute('src', /^blob:/)
  expect(authorized).toBe(true)
  await expect(page.getByRole('link', { name: 'private.png ↓' })).toHaveAttribute('download', 'private.png')
})
test('attachments: size errors keep the text draft and do not send', async ({ page }) => {
  await attachmentBot(page)
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.fill('Keep my draft')
  await page.getByLabel('Attach files', { exact: true }).setInputFiles({ name: 'large.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })
  await expect(page.getByRole('alert')).toContainText('10 MB or smaller')
  await expect(input).toHaveValue('Keep my draft')
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
})
test('portal-style login uses shared inputs and Zod validation',async({page})=>{await page.goto('/login');await expect(page.getByRole('heading',{name:'Login to your account'})).toBeVisible();await page.getByLabel('Email Address / Username').fill('x');await page.getByRole('textbox',{name:'Password'}).fill('short');await expect(page.getByRole('button',{name:'Login'})).toBeDisabled();await expect(page).toHaveScreenshot('rue-portal-login.png',{animations:'disabled',fullPage:true})})
test('credential login completes through the typed tRPC mutation',async({page})=>{await page.goto('/login');await page.getByLabel('Email Address / Username').fill('rue@example.com');await page.getByRole('textbox',{name:'Password'}).fill('correct-horse-battery');await page.getByRole('button',{name:'Login'}).click();await expect(page).toHaveURL('http://127.0.0.1:5173/');await expect(page.getByText('rue@example.com')).toBeVisible()})
test('anonymous users receive the Keyname login page',async({page})=>{await page.goto('/');await expect(page).toHaveURL(/\/login\?redirect=%2F/);await expect(page.getByRole('heading',{name:'Login to your account'})).toBeVisible();await expect(page.getByRole('button',{name:/Sign in with Keyname/})).toBeEnabled()})
test('Keyname modal signs in and sign-out returns to login',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await expect(page).toHaveURL('http://127.0.0.1:5173/');await expect(page.getByText('rue@example.com')).toBeVisible();await expect(page.getByText('Your Rue crew starts here.')).toBeVisible();await page.getByRole('button',{name:'Sign out'}).click();await expect(page).toHaveURL(/\/login/)})
test('workspace creates a session and completes a message round trip',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Chief of Staff');await page.getByLabel('Description').fill('Plans the day and keeps work moving.');await page.getByRole('button',{name:'Add bot'}).click();const message=page.getByRole('textbox',{name:'Message',exact:true});await message.fill('Hello Rue');await page.getByRole('button',{name:'Send message'}).click();await expect(message).toHaveValue('');await expect(page.getByText('Done.')).toBeVisible();await expect(page.getByText('Hello from Rue')).toBeVisible()})
test('typing in a long conversation skips transcript rendering and keeps every character',async({page},testInfo)=>{
 await page.addInitScript(()=>{
  const w=window as any;w.__renderCounts={ChatMessage:0,Markdown:0,ConversationTranscript:0};w.__inputFrames=[]
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject:(renderer:unknown)=>{w.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.set(1,renderer);return 1},onCommitFiberUnmount(){},onCommitFiberRoot(_id:number,root:any){const previous=w.__committedFibers??new Set(),committed=new Set(),stack=[root.current];while(stack.length){const node=stack.pop(),name=node.type?.name;committed.add(node);if(!previous.has(node)&&(node.flags&1)&&name in w.__renderCounts)w.__renderCounts[name]++;if(node.child)stack.push(node.child);if(node.sibling)stack.push(node.sibling)}w.__committedFibers=committed}}
  window.addEventListener('input',event=>{if(event.target instanceof HTMLTextAreaElement){const start=event.timeStamp;requestAnimationFrame(()=>w.__inputFrames.push(performance.now()-start))}})
 })
 const messages=Array.from({length:200},(_,i)=>({id:`long-${i}`,sessionId:'ses_1',role:i%2?'assistant':'user',time:Date.UTC(2026,8,18),provider:null,model:null,agent:null,meta:{},seq:i})),parts=messages.map(m=>({id:`part-${m.id}`,sessionId:'ses_1',messageId:m.id,type:'text',seq:0,payload:{text:`### Message ${m.id}\n\nEvidence and **details**. `.repeat(8)}}))
 await page.route('http://localhost:4097/session/ses_1/messages',route=>route.fulfill({json:messages}));await page.route('http://localhost:4097/session/ses_1/parts',route=>route.fulfill({json:parts}))
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Long conversation');await page.getByRole('button',{name:'Add bot',exact:true}).click()
 await expect(page.locator('.message-row')).toHaveCount(200)
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 expect(await page.evaluate(()=>(window as any).__renderCounts.ChatMessage)).toBeGreaterThan(0)
 await page.evaluate(()=>{const w=window as any;w.__renderCounts={ChatMessage:0,Markdown:0,ConversationTranscript:0};w.__inputFrames=[]})
 const text='Typing stays an unsent draft with all characters intact. '.repeat(3),input=page.getByRole('textbox',{name:'Message',exact:true})
 await input.pressSequentially(text,{delay:2});await expect(input).toHaveValue(text)
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const result=await page.evaluate(()=>{const w=window as any,frames=w.__inputFrames.sort((a:number,b:number)=>a-b);return{renders:w.__renderCounts,samples:frames.length,p95InputToFrameMs:frames[Math.floor(frames.length*.95)]}})
 expect(result.renders).toEqual({ChatMessage:0,Markdown:0,ConversationTranscript:0});expect(result.samples).toBe(text.length)
 await testInfo.attach('typing-profile',{body:JSON.stringify(result),contentType:'application/json'})
})
test('redirect login mode is available',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:'Create an account'}).click();await expect.poll(()=>page.evaluate(()=>window.__keynameMode)).toBe('redirect')})
test('creates a QR, link, and fallback code for another device',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Chief of Staff');await page.getByLabel('Description').fill('Plans the day and keeps work moving.');await page.getByRole('button',{name:'Add bot'}).click();await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('tab',{name:'Server',exact:true}).click();await page.getByRole('button',{name:'Link device'}).click();await page.getByRole('button',{name:'Create secure pairing'}).click();await expect(page.getByAltText('Scan to link this Rue account')).toBeVisible();await expect(page.getByText('12345678')).toBeVisible();await expect(page.getByLabel('Pairing link')).toHaveValue('rue://link?token=pair-secret')})
test('redeems a pairing link after Keyname authentication',async({page})=>{await page.goto('/link?token=pair-secret');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await expect(page.getByText('Device linked. Your Rue sessions are ready.')).toBeVisible()})
test('bot workspace supports bot creation and deletion',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click();await expect(page.getByRole('dialog',{name:'Add new bot'})).toBeVisible();await page.getByLabel('Bot name').fill('Research partner');await page.getByLabel('Description').fill('Finds evidence and summarizes decisions.');await page.getByRole('button',{name:'Add bot'}).click();await expect(page.locator('.conversation-header').getByText('Research partner',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveAttribute('placeholder','Message Research partner');await expect(page.getByLabel('Sessions').getByText('Finds evidence and summarizes decisions.')).toHaveText('Finds evidence and summarizes decisions.');await page.getByLabel('Workspace options').click();await page.getByRole('button',{name:'Delete bot'}).click();await expect(page.getByRole('dialog',{name:'Delete bot?'})).toBeVisible();await page.getByRole('dialog',{name:'Delete bot?'}).getByRole('button',{name:'Delete bot'}).click();await expect(page.getByText('Your Rue crew starts here.')).toBeVisible()})
test('bot workspace matches the approved responsive visual layout',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Chief of Staff');await page.getByLabel('Description').fill('Plans the day and keeps work moving.');await page.getByRole('button',{name:'Add bot'}).click();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Prepare tomorrow’s briefing');await page.getByRole('button',{name:'Send message'}).click();await expect(page.getByText('Hello from Rue')).toBeVisible();await expect(page).toHaveScreenshot('rue-bot-workspace.png',{animations:'disabled',fullPage:true})})
test('reconnecting the stream refreshes externally changed session state', async ({ page }) => {
  let connections = 0
  let release!: () => void
  const firstConnection = new Promise<void>((resolve) => { release = resolve })
  await page.route('http://localhost:4097/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'ses_external', title: connections >= 2 ? 'Changed on another client' : 'Before reconnect', agent: null, provider: 'test', model: 'test', directory: null, scopes: [], parentId: null, ownerSubject: 'usr_test', createdAt: 1, updatedAt: 2, meta: {} },
  ]) }))
  await page.route('http://localhost:4097/event', async (route) => {
    connections++
    if (connections === 1) await firstConnection
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"id":0,"type":"hello","time":1,"payload":{}}\n\n' })
  })
  try {
    await page.goto('/login')
    await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
    await expect(page.getByLabel('Sessions')).toContainText('Before reconnect')
    release()
    await expect(page.getByLabel('Sessions')).toContainText('Changed on another client')
    expect(connections).toBeGreaterThanOrEqual(2)
  } finally { release() }
})
test('bot creation accepts a name without requiring a description', async ({ page }) => {
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Create first bot' }).click()
  await page.getByLabel('Bot name').fill('Minimal bot')
  await page.getByRole('button', { name: 'Add bot', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add new bot' })).toHaveCount(0)
  await expect(page.locator('.conversation-header')).toContainText('Minimal bot')
})
test('suggested bots deploy to full Mason with consent and reuse uncertain creation identity',async({page})=>{
 const calls:any[]=[],session={id:'ses_managed',title:'Code reviewer',agent:null,provider:'openai',model:'preferred-model',directory:null,scopes:[],parentId:null,ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{managedAgentId:'agent1',workerName:'Mason'}},host={id:'mason',ownerSubject:'usr_test',name:'Mason',status:'online',desired:'active',health:{acceptingWork:false,capabilities:['managed-agents-v1']}}
 await page.route('http://localhost:4097/workers',route=>route.fulfill({json:{workers:[host,{...host,id:'other',name:'Other owner',ownerSubject:'someone-else'},{...host,id:'offline',name:'Offline',status:'offline'}]}}))
 await page.route('http://localhost:4097/provider-keys',route=>route.fulfill({json:{ownerSubject:'usr_test',keyStorageAvailable:true,keys:[{provider:'openai',configured:true,revision:1,model:'preferred-model',grants:[]}]}}))
 await page.route('http://localhost:4097/provider-keys/catalog',route=>route.fulfill({json:{providers:[{id:'openai',name:'OpenAI',models:[{id:'preferred-model',name:'Preferred model',contextWindow:128000},{id:'other-model',name:'Other model',contextWindow:128000}]}]}}))
 await page.route('http://localhost:4097/managed-agents',route=>{if(route.request().method()==='GET')return route.fulfill({json:{agents:[]}});calls.push(route.request().postDataJSON());return route.fulfill(calls.length===1?{status:503,json:{error:'lost_acknowledgement'}}:{json:{agent:{id:'agent1',sessionId:session.id}}})})
 await page.route('http://localhost:4097/session/ses_managed',route=>{if(route.request().method()==='PATCH')Object.assign(session,route.request().postDataJSON());return route.fulfill({json:session})})
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click()
 const dialog=page.getByRole('dialog',{name:'Add new bot',exact:true})
 await dialog.getByRole('button',{name:/Code reviewer Review changes/}).click();await expect(dialog.getByLabel('Bot name')).toHaveValue('Code reviewer')
 await dialog.getByRole('combobox',{name:'Deployment location',exact:true}).click();await expect(page.getByRole('option',{name:/Other owner|Offline/})).toHaveCount(0);await page.getByRole('option',{name:'Mason · waiting for capacity',exact:true}).click()
 await expect(dialog.getByRole('combobox',{name:'Model ID',exact:true})).toContainText('Preferred model');await expect(dialog.getByRole('textbox',{name:'Model ID',exact:true})).toHaveCount(0)
 await dialog.getByRole('checkbox',{name:'Authorize managed bot execution',exact:true}).check()
 await dialog.getByRole('combobox',{name:'Model ID',exact:true}).click();await page.getByRole('option',{name:'Other model · other-model',exact:true}).click()
 await expect(dialog.getByRole('button',{name:'Add bot',exact:true})).toBeDisabled()
 await dialog.getByRole('combobox',{name:'Model ID',exact:true}).click();await page.getByRole('option',{name:'Preferred model · preferred-model',exact:true}).click()
 await dialog.getByRole('checkbox',{name:'Authorize managed bot execution',exact:true}).check();await dialog.getByRole('button',{name:'Add bot',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible()
 await dialog.getByRole('button',{name:'Add bot',exact:true}).click();await expect(dialog).toHaveCount(0)
 expect(calls).toHaveLength(2);expect(calls[0].requestId).toBe(calls[1].requestId);expect(calls[0]).toMatchObject({workerId:'mason',name:'Code reviewer',acknowledgeExecution:true,config:{provider:'openai',model:'preferred-model',permission:'read-only',mounts:[],shareToolOutput:true,shareThinking:true}})
 await expect(page.locator('.conversation-header')).toContainText('Code reviewer')
})
test('Codex bot creation validates the managed catalog and preserves uncertain request identity',async({page})=>{
 const calls:any[]=[],session={id:'ses_codex_create',title:'Honeycluster Portal',agent:'pi-terminal',provider:'openai-codex',model:'gpt-6-astra',directory:null,scopes:[],parentId:null,ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{managedAgentId:'codex-agent'}}
 await page.route('http://localhost:4097/workers',r=>r.fulfill({json:{workers:[{id:'mason',name:'Mason',ownerSubject:'usr_test',status:'online',desired:'active',health:{acceptingWork:true,capabilities:['managed-agents-v1','managed-codex-v1']}}]}}))
 await page.route('http://localhost:4097/provider-keys/catalog',r=>r.fulfill({json:{providers:[{id:'openai',name:'OpenAI',models:[{id:'gpt-4.1-mini',name:'Cloud model'}]}],managedProviders:[{id:'openai-codex',name:'OpenAI Codex',models:[{id:'gpt-6-astra',name:'GPT-6 Astra'}]}]}}))
 await page.route('http://localhost:4097/managed-agents',r=>{if(r.request().method()==='GET')return r.fulfill({json:{agents:[]}});calls.push(r.request().postDataJSON());return r.fulfill(calls.length===1?{status:503,json:{error:'lost_acknowledgement'}}:{json:{agent:{id:'codex-agent',sessionId:session.id}}})})
 await page.route('http://localhost:4097/session/ses_codex_create',r=>{if(r.request().method()==='PATCH')Object.assign(session,r.request().postDataJSON());return r.fulfill({json:session})})
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click()
 const dialog=page.getByRole('dialog',{name:'Add new bot',exact:true})
 await dialog.getByLabel('Bot name').fill('Honeycluster Portal')
 await dialog.getByRole('combobox',{name:'Deployment location',exact:true}).click();await page.getByRole('option',{name:'Mason · ready',exact:true}).click()
 await dialog.getByRole('combobox',{name:'Bot provider',exact:true}).click();await page.getByRole('option',{name:'OpenAI Codex',exact:true}).click()
 await dialog.getByRole('combobox',{name:'Model ID',exact:true}).click();await page.getByRole('option',{name:'GPT-6 Astra · gpt-6-astra',exact:true}).click()
 await dialog.getByRole('checkbox',{name:'Authorize managed bot execution',exact:true}).check()
 await dialog.getByRole('button',{name:'Add bot',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible()
 expect(calls).toHaveLength(1)
 await dialog.getByRole('button',{name:'Add bot',exact:true}).click();await expect(dialog).toHaveCount(0)
 expect(calls).toHaveLength(2);expect(calls[0].requestId).toBe(calls[1].requestId)
 expect(calls[0]).toMatchObject({workerId:'mason',name:'Honeycluster Portal',config:{provider:'openai-codex',model:'gpt-6-astra'},acknowledgeExecution:true})
 await expect(page.locator('.conversation-header')).toContainText('Honeycluster Portal')
})
test('a rejected bot creation displays an error and retains the draft for retry', async ({ page }) => {
  await page.route('http://localhost:4097/session', async (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"KEYNAME_AUTH_INVALID"}' })
    return route.fallback()
  })
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Create first bot' }).click()
  await page.getByLabel('Bot name').fill('Keep this draft')
  await page.getByRole('button', { name: 'Add bot', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Your draft has been kept')
  await expect(page.getByLabel('Bot name')).toHaveValue('Keep this draft')
  await expect(page.getByRole('button', { name: 'Add bot', exact: true })).toBeEnabled()
})
test('Keyname sign-in rejection shows a safe error instead of an unhandled promise', async ({ page }) => {
  const failures: string[] = []; page.on('pageerror', () => failures.push('unhandled'))
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /Sign in with Keyname/ })).toBeEnabled()
  await page.evaluate(() => { window.Keyname!.signIn = async () => { throw new Error('private-provider-diagnostic') } })
  await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await expect(page.getByRole('alert')).toContainText('Could not complete Keyname sign-in')
  await expect(page.locator('body')).not.toContainText('private-provider-diagnostic')
  expect(failures).toEqual([])
})
test('new and selected empty bots open chat and send to the active bot', async ({ page }) => {
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  for (const name of ['First bot', 'Second bot']) {
    await page.getByRole('button', { name: 'Create bot', exact: true }).click()
    await page.getByLabel('Bot name').fill(name)
    await page.getByRole('button', { name: 'Add bot', exact: true }).click()
    await expect(page.getByRole('heading', { name: `Chat with ${name}` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add new bot', exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    if (name === 'First bot' && test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Open bot menu' }).click()
  }
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Open bot menu' }).click()
  await page.getByRole('navigation', { name: 'Sessions' }).getByRole('button', { name: /First bot/ }).click()
  await expect(page.getByRole('heading', { name: 'Chat with First bot' })).toBeVisible()
  const sent = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/session/ses_1/message'))
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Hello selected bot')
  await page.getByRole('button', { name: 'Send message' }).click(); await sent
  await expect(page.getByText('Hello selected bot', { exact: true })).toBeVisible()
  await expect(page.getByText('Hello from Rue', { exact: true })).toBeVisible()
})
test('failed first message stays in the active chat with a retryable draft', async ({ page }) => {
  await page.route('http://localhost:4097/session/*/message', r => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"no_credentials_for:openrouter"}' }))
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Create first bot' }).click()
  await page.getByLabel('Bot name').fill('Retry bot'); await page.getByRole('button', { name: 'Add bot', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('Keep my message'); await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('alert')).toContainText(/Your draft has been (kept|restored)/)
  await expect(composer).toHaveValue('Keep my message')
  await expect(page.getByRole('heading', { name: 'Chat with Retry bot' })).toBeVisible()
})
test('settings navigation and cloud defaults work on desktop and mobile', async ({ page }) => {
  let saved = { ownerSubject: 'usr_test', harness: 'pi', provider: 'openai', model: 'gpt-4.1-mini', systemPrompt: 'Be helpful.', revision: 0, apiKeyConfigured: false, keyStorageAvailable: true, models: ['gpt-4.1-mini', 'gpt-5-mini'] }
  const submitted: Array<Record<string, unknown>> = []
  await page.route('http://localhost:4097/agent/settings', async route => {
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON(); submitted.push(input)
      saved = { ...saved, model: input.model, systemPrompt: input.systemPrompt, revision: saved.revision + 1, apiKeyConfigured: input.apiKey === null ? false : input.apiKey ? true : saved.apiKeyConfigured }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) })
  })
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Open settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  const mobile = (page.viewportSize()?.width ?? 1000) <= 640
  await expect(dialog.getByRole('tablist',{name:'Settings categories'})).toHaveAttribute('aria-orientation', mobile ? 'horizontal' : 'vertical')
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(page.locator('.bot-profile').getByRole('button', { name: 'Settings' })).toHaveCount(0)
  await expect(dialog.getByRole('tabpanel', { name: 'Appearance', exact: true })).toBeVisible()
  for (const category of ['Appearance', 'Models', 'AI keys', 'MCP', 'Agents', 'Hosts', 'Server', 'Support']) await expect(dialog.getByRole('tab', { name: category, exact: true })).toBeVisible()
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).press('End')
  await expect(dialog.getByRole('tab', { name: 'Support', exact: true })).toBeFocused()
  await dialog.getByRole('tab', { name: 'Support', exact: true }).press('Home')
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).press(mobile ? 'ArrowRight' : 'ArrowDown')
  await expect(dialog.getByRole('tab', { name: 'Models', exact: true })).toBeFocused()
  for (const name of ['Model', 'System prompt']) {
    const label = await dialog.locator('label').filter({ hasText: new RegExp(`^${name}$`) }).boundingBox()
    const control = await dialog.getByLabel(name, { exact: true }).boundingBox()
    expect(label && control && label.y + label.height <= control.y).toBe(true)
  }
  await page.getByRole('combobox', { name: 'Model', exact: true }).click()
  await page.getByRole('option', { name: 'gpt-5-mini', exact: true }).click()
  await page.getByLabel('System prompt').fill('Help me plan my day.')
  await dialog.getByRole('tab', { name: 'Support', exact: true }).click()
  await expect(dialog.getByRole('link', { name: /Documentation/ })).toHaveAttribute('href', /\/settings$/)
  await dialog.getByRole('tab', { name: 'MCP', exact: true }).click()
  await expect(dialog.getByRole('tabpanel', { name: 'MCP', exact: true })).toContainText('not enabled')
  await dialog.getByRole('tab', { name: 'Models', exact: true }).click()
  await expect(page.getByLabel('System prompt')).toHaveValue('Help me plan my day.')
  await expect(page.getByLabel('OpenAI API key', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save defaults' }).click()
  await expect(dialog).toHaveCount(0)
  expect(submitted[0]).toMatchObject({ harness: 'pi', provider: 'openai', model: 'gpt-5-mini', systemPrompt: 'Help me plan my day.', expectedOwnerSubject: 'usr_test' })
  expect(submitted[0]).not.toHaveProperty('apiKey')
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('tab', { name: 'Models', exact: true }).click()
  await expect(page.getByLabel('System prompt')).toHaveValue('Help me plan my day.')
  await page.getByRole('tab', { name: 'Support', exact: true }).click()
  await dialog.getByRole('link', { name: /Report an issue/ }).press('Tab')
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Close dialog' }).press('Shift+Tab')
  await expect(dialog.getByRole('link', { name: /Report an issue/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open settings' })).toBeFocused()
})
test('key tables sort and combine provider filters with search without grouping',async({page})=>{
 const keys=['openai','anthropic','google','openrouter'].map((provider,i)=>({provider,configured:true,revision:1,model:`model-${i}`,grants:[]}))
 await page.route('http://localhost:4097/provider-keys',route=>route.fulfill({json:{ownerSubject:'usr_test',keyStorageAvailable:true,keys}}))
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('tab',{name:'AI keys',exact:true}).click()
 const table=page.getByRole('table',{name:'Provider API keys',exact:true}),rows=table.locator('tbody tr')
 await expect(rows).toHaveCount(4)
 await table.getByRole('button',{name:'Provider',exact:true}).click();await expect(rows.first().getByRole('cell',{name:'Anthropic',exact:true})).toBeVisible()
 await table.getByRole('button',{name:'Provider',exact:true}).click();await expect(rows.first().getByRole('cell',{name:'OpenRouter',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Filters',exact:true}).click();const filters=page.getByRole('dialog',{name:'Provider API keys filters',exact:true})
 await filters.getByRole('checkbox',{name:'Anthropic',exact:true}).check();await filters.getByRole('checkbox',{name:'Google',exact:true}).check();await expect(rows).toHaveCount(2)
 await filters.getByRole('button',{name:'Close filters',exact:true}).click()
 const search=page.getByRole('searchbox',{name:'Search provider api keys',exact:true});await search.fill('open');await expect(table).toContainText('No rows match these filters.');await search.fill('');await expect(rows).toHaveCount(2)
 await page.getByRole('button',{name:'Filters',exact:true}).click();await filters.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(rows).toHaveCount(4)
})
test('add AI key detects Codex OAuth, confirms the account and never stores tokens in the browser',async({page})=>{
 let configured=false;let id='';let confirmed=0;let cancelled=0;let pollCount=0;const starts:string[]=[]
 const metadata=()=>({ownerSubject:'usr_test',provider:'openai-codex',credentialType:'oauth',configured,revision:configured?1:0,state:configured?'ready':'removed',expiresAt:null,keyStorageAvailable:true,runtimeSupported:false,grants:[]})
 await page.route('http://localhost:4097/provider-keys',route=>route.fulfill({json:{ownerSubject:'usr_test',keyStorageAvailable:true,keys:[{provider:'openai',configured:false,revision:0,grants:[]}],oauth:metadata()}}))
 await page.route('http://localhost:4097/provider-keys/catalog',route=>route.fulfill({json:{providers:[{id:'openai',name:'OpenAI',models:[]}],credentialProviders:[{id:'openai',name:'OpenAI',auth:'api_key'},{id:'openai-codex',name:'OpenAI Codex',auth:'oauth'}]}}))
 await page.route('http://localhost:4097/provider-oauth/openai-codex',route=>route.fulfill({json:metadata()}))
 const flow=(status:string)=>({id,provider:'openai-codex',status,expiresAt:Date.now()+600000,pollAfterMs:1,...(status==='pending'?{userCode:'CODE-1234',verificationUri:'https://auth.openai.com/codex/device'}:{}),...(status==='review'?{accountId:'account_test'}:{})})
 await page.route('http://localhost:4097/provider-oauth/openai-codex/start',route=>{const input=route.request().postDataJSON();expect(input).toMatchObject({expectedOwnerSubject:'usr_test',expectedRevision:0,acknowledgeStorage:true});id=input.requestId;starts.push(id);return route.fulfill({json:flow('pending')})})
 await page.route('http://localhost:4097/provider-oauth/openai-codex/flows/**',route=>{
 const path=new URL(route.request().url()).pathname
 if(path.endsWith('/poll')){pollCount++;return route.fulfill({json:flow(pollCount===1?'pending':'review')})}
 if(path.endsWith('/confirm')){expect(route.request().postDataJSON()).toMatchObject({expectedOwnerSubject:'usr_test',acknowledgeAccount:true});confirmed++;configured=true;return route.fulfill({json:flow('complete')})}
 cancelled++;return route.fulfill({json:flow(configured?'complete':'cancelled')})
 })
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('tab',{name:'AI keys',exact:true}).click();await page.getByRole('button',{name:'Add new key'}).click()
 await page.getByLabel('OpenAI API key',{exact:true}).fill('discard-this-draft')
 await page.getByRole('combobox',{name:'AI provider'}).click();await page.getByRole('option',{name:'OpenAI Codex',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Connect OpenAI Codex',exact:true});await expect(dialog.locator('input[type=password]')).toHaveCount(0)
 await expect(dialog.getByRole('button',{name:'Sign in with OpenAI'})).toBeDisabled();await dialog.getByRole('checkbox',{name:/Authorize Rue to store/}).check();await dialog.getByRole('button',{name:'Sign in with OpenAI'}).click()
 await expect(dialog.getByLabel('OpenAI one-time code')).toHaveValue('CODE-1234')
 await page.getByRole('combobox',{name:'AI provider'}).click();await page.getByRole('option',{name:'OpenAI',exact:true}).click();await expect.poll(()=>cancelled).toBe(1);await expect(page.getByLabel('OpenAI API key',{exact:true})).toHaveValue('')
 await page.getByRole('combobox',{name:'AI provider'}).click();await page.getByRole('option',{name:'OpenAI Codex',exact:true}).click();await dialog.getByRole('checkbox',{name:/Authorize Rue to store/}).check();await dialog.getByRole('button',{name:'Sign in with OpenAI'}).click()
 await expect(dialog.getByLabel('OpenAI one-time code')).toHaveValue('CODE-1234');expect(starts).toHaveLength(2);expect(starts[0]).not.toBe(starts[1]);await expect(dialog.getByRole('link',{name:/Open OpenAI/})).toHaveAttribute('href','https://auth.openai.com/codex/device')
 await page.screenshot({path:test.info().outputPath('codex-device-login.png'),animations:'disabled'})
 await expect(dialog.getByText('account_test',{exact:true})).toBeVisible();expect(confirmed).toBe(0)
 await expect(dialog.getByRole('button',{name:'Save Codex connection'})).toBeDisabled();await dialog.getByRole('checkbox',{name:/I confirm this is the OpenAI account/}).check();await dialog.getByRole('button',{name:'Save Codex connection'}).click()
 await expect(dialog).toHaveCount(0);await expect(page.getByRole('table',{name:'Provider API keys'})).toContainText('OpenAI Codex');expect(confirmed).toBe(1)
 await expect(page.getByRole('row').filter({hasText:'OpenAI Codex'}).getByRole('button',{name:'Manage access'})).toBeDisabled()
 expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toMatch(/CODE-1234|discard-this-draft|account_test/)
 await expect.poll(()=>cancelled).toBe(2)
})
test('AI keys stay out of browser storage and require explicit per-machine grants', async ({ page }) => {
  const calls: Array<Record<string, unknown>> = []
  let keys = ['openai','anthropic','google','openrouter'].map(provider => ({ provider, model:null as string|null,configured: false, revision: 0, grants: [] as Array<{ type: string; id: string }> }))
  await page.route('http://localhost:4097/provider-keys**', async route => {
    if(new URL(route.request().url()).pathname==='/provider-keys/catalog')return route.fulfill({json:{providers:keys.map(key=>({id:key.provider,name:key.provider,models:Array.from({length:151},(_,i)=>({id:`${key.provider}-model-${i}`,name:`Model ${i}`,contextWindow:128000}))}))}})
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON(); calls.push(input)
      const provider = new URL(route.request().url()).pathname.split('/')[2]
      keys = keys.map(key => key.provider !== provider ? key : { ...key, revision: key.revision + 1,
        configured: 'apiKey' in input ? input.apiKey !== null : key.configured,model:input.apiKey===null?null:input.model??key.model,
        grants: 'target' in input ? input.enabled ? [...key.grants, input.target] : key.grants.filter(g => g.id !== input.target.id) : input.apiKey === null ? [] : key.grants })
    }
    await route.fulfill({ json: { ownerSubject: 'usr_test', keyStorageAvailable: true, keys } })
  })
  await page.route('http://localhost:4097/computers', route => route.fulfill({ json: { computers: [] } }))
  await page.route('http://localhost:4097/workers', route => route.fulfill({ json: { workers: [{ id: 'host-mason', ownerSubject: 'usr_test', name: 'Mason', status: 'online', managedAgentCount: 0 }] } }))
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('tab', { name: 'AI keys', exact: true }).click()
  const table=page.getByRole('table',{name:'Provider API keys',exact:true}),card=table.getByRole('row').filter({has:page.getByRole('cell',{name:'Anthropic',exact:true})})
  await expect(table).toContainText('No saved keys.');await expect(table.getByRole('row')).toHaveCount(2)
  async function addAnthropic(){await page.getByRole('button',{name:'Add new key',exact:true}).click();await page.getByRole('combobox',{name:'AI provider',exact:true}).click();await page.getByRole('option',{name:'anthropic',exact:true}).click()}
  await addAnthropic()
  await expect(page.getByLabel('Anthropic API key')).toHaveAttribute('type', 'password')
  await page.getByLabel('Anthropic API key').fill('discarded-draft-secret')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible()
  await page.getByRole('tab', { name: 'Support', exact: true }).click()
  await page.getByRole('tab', { name: 'AI keys', exact: true }).click()
  await addAnthropic()
  await expect(page.getByLabel('Anthropic API key')).toHaveValue('')
  await page.getByLabel('Find models').fill('model-149')
  await page.getByRole('combobox',{name:'Default model',exact:true}).click();await page.getByRole('option',{name:'Model 149 · anthropic-model-149',exact:true}).click()
  await page.getByLabel('Anthropic API key').fill('test-provider-key')
  await page.getByRole('dialog',{name:'Add AI key',exact:true}).getByRole('button', { name: 'Save key' }).click()
  await expect(card.getByLabel('Key saved')).toBeVisible()
  const search=page.getByRole('searchbox',{name:'Search provider api keys',exact:true})
  await search.fill('no matches');await expect(card).toHaveCount(0);await search.fill('Anthropic');await expect(card).toBeVisible();await search.fill('')
  await page.getByRole('button',{name:'Filters',exact:true}).click();const filters=page.getByRole('dialog',{name:'Provider API keys filters',exact:true})
  await filters.getByRole('checkbox',{name:'Google',exact:true}).check();await expect(card).toHaveCount(0)
  await filters.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(card).toBeVisible();await page.keyboard.press('Escape');await expect(filters).toHaveCount(0)
  await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible()
  expect(calls[0]).toMatchObject({ expectedOwnerSubject: 'usr_test', expectedRevision: 0, apiKey: 'test-provider-key',model:'anthropic-model-149' })
  await card.getByRole('button', { name: 'Manage access' }).click()
  const access=page.getByRole('dialog',{name:'Manage Anthropic access',exact:true})
  await access.getByRole('combobox',{name:'Grant access to',exact:true}).click();await page.getByRole('option',{name:'Host · Mason',exact:true}).click()
  await expect(access.getByRole('button', { name: 'Grant access', exact: true })).toBeDisabled()
  await access.getByRole('checkbox', { name: /Allow this machine/ }).check()
  await access.getByRole('button', { name: 'Grant access', exact: true }).click()
  await expect(access.getByRole('button', { name: 'Revoke access' })).toBeVisible()
  expect(calls[1]).toMatchObject({ expectedRevision: 1, target: { type: 'worker', id: 'host-mason' }, enabled: true, acknowledgeExposure: true })
  expect(calls[1]).not.toHaveProperty('apiKey')
  await access.getByRole('button', { name: 'Revoke access' }).click()
  await expect(access.getByRole('button', { name: 'Revoke access' })).toHaveCount(0)
  await access.getByRole('button',{name:'Close dialog',exact:true}).click()
  await page.locator('.rue-settings-content').evaluate(element=>{element.scrollTop=0})
  await page.getByRole('region',{name:'Provider API keys table scroll area',exact:true}).evaluate(element=>{element.scrollLeft=0})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await expect(page).toHaveScreenshot('rue-settings-ai-keys.png', { animations: 'disabled', fullPage: true })
  await card.getByRole('button', { name: 'Replace key' }).click()
  await expect(page.getByLabel('Anthropic API key')).toHaveValue('')
  await page.getByRole('dialog',{name:'Replace AI key',exact:true}).getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(/test-provider-key|discarded-draft-secret/)
  page.once('dialog', dialog => dialog.accept())
  await card.getByRole('button', { name: 'Remove key' }).click()
  await expect(card).toHaveCount(0);await expect(table).toContainText('No saved keys.')
  expect(calls.at(-1)?.apiKey).toBeNull()
})

test('remote computer pairing survives sign-in and approval requires an explicit click', async ({ page }) => {
  const approvals: unknown[] = []
  await page.route('http://localhost:4097/terminal/requests/*/approve', route => { approvals.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ownerSubject: 'usr_test', code: '123456789012', expiresAt: Date.now() + 300000 }) }) })
  await page.goto('/link-computer?request=' + 'a'.repeat(32))
  await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await expect(page.getByLabel('Pairing request')).toHaveValue('a'.repeat(32))
  expect(approvals).toEqual([])
  await expect(page.getByText(/Linking trusts remote prompts/)).toBeVisible()
  await expect(page.getByText(/may contain private files or secrets/)).toBeVisible()
  await page.getByLabel('Agent name').fill('Work laptop')
  await page.getByRole('button', { name: 'Link agent' }).click()
  await expect(page.getByLabel('Agent pairing code')).toHaveText('123456789012')
  expect(approvals).toEqual([{ expectedOwnerSubject: 'usr_test', botName: 'Work laptop' }])
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('123456789012')
})
test('remote computer settings show offline state and explicitly enable or revoke prompting', async ({ page }) => {
  const computer = { id: 'term_' + 'a'.repeat(32), ownerSubject: 'usr_test', sessionId: 'ses_host', name: 'Laptop', revision: 0, remoteEnabled: false, lastSeenAt: null, expiresAt: Date.now() + 86400000, status: 'offline', runs: [{ id: 'run', status: 'interrupted', created_at: Date.now(), updated_at: Date.now() }] }
  const updates: any[] = []
  await page.route('http://localhost:4097/terminal/**', async route => {
    if (route.request().method() === 'PATCH') { const data = route.request().postDataJSON(); updates.push(data); computer.remoteEnabled = data.remoteEnabled; computer.name = data.name; computer.revision++ }
    if (route.request().method() === 'DELETE') computer.status = 'revoked'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().method() === 'GET' ? { computers: [computer] } : { updated: true, revoked: true }) })
  })
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('tab', { name: 'Agents', exact: true }).click()
  await expect(page.getByRole('table',{name:'Linked agents'}).getByRole('row').filter({hasText:'Laptop'})).toContainText('Offline')
  await expect(page.getByRole('link', { name: /Help & documentation/ })).toHaveAttribute('href', /#remote-agents$/)
  await page.getByRole('searchbox',{name:'Search linked agents'}).fill('missing');await expect(page.getByRole('table',{name:'Linked agents'})).toContainText('No rows match');await page.getByRole('searchbox',{name:'Search linked agents'}).fill('')
  await page.getByRole('button',{name:'Manage Laptop',exact:true}).click()
  await page.getByRole('button', { name: 'Enable remote prompts' }).click()
  await expect(page.getByRole('button', { name: 'Disable remote prompts' })).toBeVisible()
  expect(updates[0]).toMatchObject({ expectedOwnerSubject: 'usr_test', remoteEnabled: true })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Revoke agent' }).click()
  await expect(page.getByRole('article', { name: 'Remote agent Laptop' })).toContainText('Revoked')
})
test('multi-message queue stays above the composer, retains failed checks and hides single requests', async ({ page }) => {
  const now = Date.now()
  const sessions = ['Alpha queue', 'Beta queue'].map((title, i) => ({ id: `ses_queue_${i}`, title, ownerSubject: 'usr_test', agent: 'pi-terminal', terminalConnectionId: `term_queue_${i}`, meta: {}, createdAt: now, updatedAt: now }))
  const computers = sessions.map((s, i) => ({ id: s.terminalConnectionId, sessionId: s.id, ownerSubject: 'usr_test', name: s.title, revision: 1, remoteEnabled: true, status: 'online', lastSeenAt: now, expiresAt: now + 1000000, runs: [] }))
  let active = [
    { id: 'a', text: 'First pending prompt', status: 'claimed', created_at: now, updated_at: now, user_message_id: 'u1' },
    { id: 'b', text: 'Second pending prompt', status: 'queued', created_at: now + 1, updated_at: now, user_message_id: 'u2' },
    { id: 'c', text: 'Third pending prompt', status: 'queued', created_at: now + 2, updated_at: now, user_message_id: 'u3' },
  ], fail = false
  await page.route('http://localhost:4097/session', route => route.fulfill({ json: sessions }))
  await page.route('http://localhost:4097/terminal/computers', route => route.fulfill({ json: { computers } }))
  await page.route('http://localhost:4097/terminal/computers/*/queue', route => {
    if (route.request().url().includes('term_queue_1')) return route.fulfill({ json: { messages: [{ ...active[0], id: 'beta', text: 'Only Beta prompt', status: 'queued' }] } })
    return fail ? route.fulfill({ status: 503, json: { error: 'offline' } }) : route.fulfill({ json: { messages: active } })
  })
  const select = async (name: string) => {
    const back = page.getByRole('button', { name: 'Open bot menu' })
    if (test.info().project.name === 'mobile' && await back.isVisible()) await back.click()
    await page.getByRole('navigation', { name: 'Sessions' }).getByRole('button', { name: new RegExp(name) }).click()
  }
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await select('Alpha queue')
  const panel = page.getByRole('region', { name: 'Message queue', exact: true })
  await expect(panel).toContainText('3 active messages')
  await expect(panel.locator('li')).toHaveCount(0)
  await expect(page.getByText('First pending prompt', { exact: true })).toHaveCount(0)
  expect((await panel.boundingBox())!.y + (await panel.boundingBox())!.height).toBeLessThanOrEqual((await page.locator('.composer').boundingBox())!.y)
  await expect(page.locator('.chat-scroll-viewport .message-queue')).toHaveCount(0)
  await panel.getByRole('button', { name: /3 active messages/ }).click()
  await expect(panel.locator('li')).toHaveCount(3)
  await expect(panel).toContainText('Awaiting approval')
  active[0]!.status = 'running'
  await expect(panel).toContainText('Working')
  fail = true
  await expect(panel).toContainText('Queue status may be out of date')
  await expect(panel).toContainText('3 active messages')
  fail = false;active = [active[2]!]; active[0]!.status = 'running'
  await panel.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await select('Beta queue');await expect(panel).toHaveCount(0)
  await select('Alpha queue');await expect(panel).toHaveCount(0)
  active=[];await expect(panel).toHaveCount(0)
})

test('message status pills stay top right and mirror delivery is not task success',async({page})=>{
 const statuses=['failed','running','completed','completed','completed'],messages=statuses.map((_,i)=>({id:`status-${i}`,sessionId:'ses_1',role:'assistant',time:Date.UTC(2026,8,18),provider:null,model:null,agent:null,meta:{origin:'computer'},seq:i})),parts=statuses.map((status,i)=>({id:`part-${i}`,sessionId:'ses_1',messageId:`status-${i}`,type:'text',seq:0,payload:{text:i===0?'Runtime failed safely':i===4?'The managed runtime could not complete this request. Check the selected model and its explicit AI-key grant.':`Reply ${i}`,remoteStatus:status,...(i>=3?{mirrorFinal:true}:{})}}))
 await page.route('http://localhost:4097/session/ses_1/messages',route=>route.fulfill({json:messages}));await page.route('http://localhost:4097/session/ses_1/parts',route=>route.fulfill({json:parts}))
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Status checks');await page.getByRole('button',{name:'Add bot',exact:true}).click()
 const pills=page.locator('.message-status .run-status-pill');await expect(pills).toHaveText(['Error','Running','Complete','Received','Error'])
 const positions=await pills.evaluateAll(elements=>elements.map(element=>{const pill=element.getBoundingClientRect(),bubble=element.closest('.message-bubble')!.getBoundingClientRect();return {top:pill.top-bubble.top,right:bubble.right-pill.right}}))
 for(const position of positions){expect(position.top).toBeGreaterThanOrEqual(0);expect(position.top).toBeLessThanOrEqual(12);expect(position.right).toBeGreaterThanOrEqual(0);expect(position.right).toBeLessThanOrEqual(12)}
})
test('remote prompt retry retains its command ID after an ambiguous network failure', async ({ page }) => {
  const requests: any[] = []
  await page.route('http://localhost:4097/session/*/message', async route => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) return route.abort('failed')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userMessageId: 'm_user', assistantMessageId: 'm_assistant', stopReason: 'queued' }) })
  })
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Create first bot' }).click(); await page.getByLabel('Bot name').fill('Computer bot'); await page.getByRole('button', { name: 'Add bot', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('Run on my computer'); await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('alert')).toContainText(/Your draft has been (kept|restored)/)
  await expect(composer).toHaveValue('Run on my computer')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(composer).toHaveValue('')
  await expect(page.getByText(/Sent to computer/)).toHaveCount(0)
  expect(requests).toHaveLength(2); expect(requests[0].requestId).toBeTruthy(); expect(requests[1].requestId).toBe(requests[0].requestId)
})
test('mixed bots show cloud versus paired computer, including offline and revoked links', async ({ page }) => {
  const base = { provider: null, model: null, directory: null, scopes: [], parentId: null, ownerSubject: 'usr_test', createdAt: 1, updatedAt: 1, meta: {} }
  await page.route('http://localhost:4097/session', r => r.fulfill({ json: [
    { ...base, id: 'cloud', title: 'Cloud helper', agent: null, terminalConnectionId: null },
    { ...base, id: 'remote', title: 'Remote helper', agent: 'pi', terminalConnectionId: 'term_one' },
  ] }))
  const computer = { id: 'term_one', sessionId: 'remote', ownerSubject: 'usr_test', name: 'Work laptop', remoteEnabled: false, status: 'offline', revision: 0, expiresAt: Date.now() + 60000, runs: [] }
  await page.route('http://localhost:4097/terminal/computers', r => r.fulfill({ json: { computers: [computer] } }))
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  const nav = page.getByRole('navigation', { name: 'Sessions' })
  await expect(nav.getByRole('button', { name: /Cloud helper/ })).toContainText('Cloud · Rue server')
  await expect(nav.getByRole('button', { name: /Remote helper/ })).toContainText('Remote · Work laptop · offline · prompts disabled')
  await nav.getByRole('button', { name: /Remote helper/ }).click()
  await expect(page.locator('.conversation-header')).toContainText('Remote · Work laptop')
  await expect(page.locator('.remote-chat-banner')).toHaveCount(0)
  await expect(page.locator('.conversation-header .agent-connection-controls')).toHaveCount(1)
  const banner = page.getByRole('region', { name: 'Remote connection' })
  await expect(banner.locator('.remote-status-dot')).toHaveAttribute('data-state', 'disconnected')
  await banner.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Reconnect remote bot' })).toContainText('/rue resume')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page).toHaveScreenshot('rue-mixed-bot-locations.png', { animations: 'disabled', fullPage: true })
  computer.status = 'revoked'
  await expect(banner.getByRole('button', { name: 'Connection details: Disconnected (revoked)', exact: true })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.conversation-header')).not.toContainText('Cloud · Rue server')
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Open bot menu' }).click()
  await nav.getByRole('button', { name: /Cloud helper/ }).click()
  await expect(page.locator('.conversation-header')).toContainText('Cloud · Rue server')
})
test('tool cards compact long output, retain complete details, group chunks and preserve expansion during streaming', async ({ page }) => {
  let updated = false, release!: () => void
  const eventReady = new Promise<void>(resolve => { release = resolve })
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i}: ${'x'.repeat(200)}`).join('\n') + '\nFULL_OUTPUT_TAIL'
  const transcript = () => `### Tool: edit — ${updated ? 'completed' : 'running'}\n\n**Arguments**\n\n\`\`\`json\n${JSON.stringify({ path: 'src/example.ts', edits: [{ oldText: 'old', newText: 'new' }] }, null, 2)}\n\`\`\`\n\n**Output**\n\n\`\`\`text\n${lines}\n\`\`\`\n\n**Diff**\n\n\`\`\`diff\n-old\n+new\n\`\`\``
  await page.route('http://localhost:4097/event', async route => { await eventReady; await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"id":1,"type":"part.updated","time":1,"payload":{"sessionId":"ses_1"}}\n\n' }) })
  await page.route('http://localhost:4097/session/*/messages', route => route.fulfill({ json: ['shell','tool-first','tool-tail','final'].map((id, seq) => ({ id, sessionId: 'ses_1', role: 'assistant', time: 1, seq, meta: { origin: 'computer' } })) }))
  await page.route('http://localhost:4097/session/*/parts', route => {
    const text = transcript(), cut = Math.floor(text.length / 2)
    return route.fulfill({ json: [
      { id: 'shell-part', messageId: 'shell', type: 'text', seq: 0, payload: { text: 'DUPLICATE_AGGREGATE', superseded: true } },
      ...['tool-first','tool-tail'].map((messageId, chunk) => ({ id: messageId, messageId, type: 'text', seq: 0, payload: { text: chunk ? text.slice(cut) : text.slice(0, cut), remoteStatus: updated ? 'completed' : 'running', tool: { id: 'shared-call', chunk } } })),
      { id: 'final-part', messageId: 'final', type: 'text', seq: 0, payload: { text: 'Final answer after tools.' } },
    ] })
  })
  try {
    await attachmentBot(page)
    const card = page.getByRole('region', { name: 'edit tool' })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('running')
    expect((await card.boundingBox())!.height).toBeLessThan(200)
    await expect(page.getByText('DUPLICATE_AGGREGATE')).toHaveCount(0)
    await expect(card.getByText('FULL_OUTPUT_TAIL', { exact: false })).toHaveCount(0)
    await card.getByRole('button', { name: 'Expand edit tool details' }).click()
    await expect(card).toContainText('FULL_OUTPUT_TAIL')
    await expect(card).toContainText('src/example.ts')
    updated = true; release()
    await expect(card).toContainText('completed')
    await expect(card.getByRole('button', { name: 'Collapse details' })).toBeVisible()
    await expect(card).toContainText(lines)
    await card.getByRole('button', { name: 'Collapse details' }).click()
    await expect(card.getByText('FULL_OUTPUT_TAIL', { exact: false })).toHaveCount(0)
    await expect(page.getByText('Final answer after tools.')).toBeVisible()
  } finally { release() }
})

test('exposed thinking streams in a compact separate card with full expandable text', async ({ page }) => {
  let finished = false, release!: () => void
  const update = new Promise<void>(resolve => { release = resolve })
  const thinking = Array.from({ length: 12 }, (_, i) => `Thinking line ${i}: ${'context '.repeat(30)}`).join('\n') + '\nREASONING_TAIL'
  await page.route('http://localhost:4097/event', async route => { await update; await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"id":1,"type":"part.updated","time":1,"payload":{"sessionId":"ses_1"}}\n\n' }) })
  await page.route('http://localhost:4097/session/*/messages', route => route.fulfill({ json: ['thinking-first','thinking-tail','answer'].map((id, seq) => ({ id, role: 'assistant', time: 1, seq, meta: { origin: 'computer' } })) }))
  await page.route('http://localhost:4097/session/*/parts', route => {
    const cut = Math.floor(thinking.length / 2)
    return route.fulfill({ json: [
      ...['thinking-first','thinking-tail'].map((messageId, chunk) => ({ id: messageId, messageId, type: 'reasoning', seq: 0, payload: { text: chunk ? thinking.slice(cut) : thinking.slice(0, cut), mirrorFinal: finished, remoteStatus: finished ? 'completed' : 'running', reasoning: { id: 'thinking-block', chunk } } })),
      { id: 'answer-part', messageId: 'answer', type: 'text', seq: 0, payload: { text: 'Actual assistant answer.' } },
    ] })
  })
  try {
    await attachmentBot(page)
    const card = page.getByRole('region', { name: 'Agent thinking' })
    await expect(card).toHaveCount(1); await expect(card).toContainText('running')
    expect((await card.boundingBox())!.height).toBeLessThan(200)
    await expect(card.getByText(/REASONING_TAIL/)).toHaveCount(0)
    await card.getByRole('button', { name: 'Expand thinking' }).click()
    await expect(card).toContainText('REASONING_TAIL')
    finished = true; release()
    await expect(card).toContainText('completed')
    await expect(card.locator('pre')).toHaveText(thinking)
    await expect(page.getByText('Actual assistant answer.', { exact: true })).toBeVisible()
    expect((await card.boundingBox())!.y).toBeLessThan((await page.getByText('Actual assistant answer.', { exact: true }).boundingBox())!.y)
    await card.getByRole('button', { name: 'Collapse details' }).click()
    await expect(card.getByText(/REASONING_TAIL/)).toHaveCount(0)
  } finally { release() }
})

test('legacy tool cards cap preview line length and expand without losing text', async ({ page }) => {
  const output = 'A'.repeat(500) + '\n' + Array.from({ length: 12 }, (_, i) => `row ${i}`).join('\n') + '\nLEGACY_TAIL'
  await page.route('http://localhost:4097/session/*/messages', route => route.fulfill({ json: [{ id: 'legacy', role: 'assistant', time: 1, meta: { origin: 'computer' } }] }))
  await page.route('http://localhost:4097/session/*/parts', route => route.fulfill({ json: [{ id: 'p', messageId: 'legacy', type: 'text', seq: 0, payload: { text: `Tool output: bash\n\n\`\`\`text\n${output}\n\`\`\`` } }] }))
  await attachmentBot(page)
  const card = page.getByRole('region', { name: 'bash tool' })
  await expect(card).toContainText('Preview shortened')
  const preview = await card.locator('pre').innerText()
  expect(preview.split('\n')).toHaveLength(5); expect(preview.split('\n')[0]!.length).toBe(141)
  await card.getByRole('button', { name: 'Expand bash tool details' }).click()
  await expect(card.locator('pre')).toHaveText(output)
})

test('message footers are mounted only for focused or tapped messages, not hover', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await attachmentBot(page)
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  await draft.fill('Footer test'); await page.getByRole('button', { name: 'Send message' }).click()
  const assistant = page.locator('.message-row.assistant'), user = page.locator('.message-row.user')
  await expect(assistant).toContainText('Hello from Rue')
  await expect(page.locator('.message-actions')).toHaveCount(0)
  await assistant.locator('.message-bubble').hover()
  await expect(page.locator('.message-actions')).toHaveCount(0)
  await expect(assistant.locator('.message-bubble')).not.toHaveAttribute('title')
  if (test.info().project.name === 'mobile') await assistant.locator('.message-bubble').tap()
  else await assistant.locator('.message-bubble').click()
  await expect(assistant.locator('.message-actions')).toHaveCount(1)
  await expect(assistant.locator('time')).toHaveCount(1)
  // Moving keyboard focus into footer actions must keep them mounted.
  const copy = assistant.locator('.message-actions').getByRole('button', { name: 'Copy message' })
  await copy.focus(); await expect(copy).toBeVisible(); await copy.click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Hello from Rue')
  await user.locator('.message-bubble').click()
  await expect(assistant.locator('.message-actions')).toHaveCount(0)
  await expect(user.locator('.message-actions')).toHaveCount(1)
  // A non-focusable outside target also dismisses a touch-selected footer.
  await page.locator('.conversation-header').click()
  await expect(page.locator('.message-actions')).toHaveCount(0)
  await assistant.locator('.message-bubble').focus()
  await expect(assistant.locator('.message-actions')).toHaveCount(1)
  await draft.focus()
  await expect(page.locator('.message-actions')).toHaveCount(0)
  await expect(page.locator('.message-row time')).toHaveCount(0)
})

test('rich chat renders safe Markdown and code with copy and timestamps', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const text = '# Report\n\n**Summary** and `inline`\n\n- One\n- Two\n\n```js\nconst answer = 42\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![tracker](https://tracker.test/pixel)\n\n<script>window.__unsafe = true</script>\n\n[bad](javascript:alert%281%29)'
  const external: string[] = []; page.on('request', r => { if(r.url().includes('tracker.test')) external.push(r.url()) })
  await page.route('http://localhost:4097/session/*/parts', r => r.fulfill({ json: [{ id: 'txt_user', sessionId: 'ses_1', messageId: 'msg_user', type: 'text', seq: 0, payload: { text: 'Format a report' } }, { id: 'txt_assistant', sessionId: 'ses_1', messageId: 'msg_assistant', type: 'text', seq: 0, payload: { text } }] }))
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Create first bot' }).click(); await page.getByLabel('Bot name').fill('Rich chat'); await page.getByRole('button', { name: 'Add bot', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Format a report'); await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('heading', { name: 'Report', exact: true })).toBeVisible()
  await expect(page.locator('.rue-markdown table')).toBeVisible()
  await page.getByRole('button', { name: 'Copy code', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('const answer = 42')
  expect(external).toEqual([])
  expect(await page.evaluate(() => (window as any).__unsafe)).toBeUndefined()
  await expect(page.locator('.message-row.assistant .message-bubble')).toHaveAttribute('title', /2026/)
  await expect(page.locator('.message-row.assistant time')).toHaveAttribute('datetime', '2026-09-18T12:00:00.000Z')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page).toHaveScreenshot('rue-rich-chat.png', { animations: 'disabled', fullPage: true })
})
test('bot settings persist groups, labels and colors; management commands never reach the model', async ({ page }) => {
  const session = { id: 'ses_custom', title: 'Custom bot', agent: null, terminalConnectionId: null, provider: null, model: null, directory: null, scopes: [], parentId: null, ownerSubject: 'usr_test', createdAt: 1, updatedAt: 1, meta: {} as Record<string, unknown> }
  const prompts: string[] = []
  await page.route('http://localhost:4097/session', r => r.fulfill({ json: [session] }))
  await page.route('http://localhost:4097/session/ses_custom', r => { if(r.request().method() === 'PATCH') Object.assign(session,r.request().postDataJSON());return r.fulfill({ json: session }) })
  await page.route('http://localhost:4097/session/ses_custom/message', r => { prompts.push(r.request().postData()!); return r.fulfill({ json: { userMessageId:'u',assistantMessageId:'a',stopReason:'completed' } }) })
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('navigation', { name: 'Sessions' }).getByRole('button', { name: /Custom bot/ }).click()
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  await draft.fill('/settings'); await page.getByRole('button', { name: 'Send message' }).click()
  const dialog = page.getByRole('complementary', { name: 'Settings', exact: true })
  await dialog.getByLabel('Group', { exact: true }).fill('Work')
  await dialog.getByLabel('Labels', { exact: true }).fill('daily, research')
  await dialog.getByRole('button',{name:'Use purple bot color',exact:true}).click()
  await dialog.getByRole('combobox',{name:'Chat bubble color',exact:true}).click();await page.getByRole('option',{name:'purple',exact:true}).click()
  await dialog.getByRole('button',{name:'Routines',exact:true}).click()
  await expect(dialog.getByRole('heading',{name:'Routine draft',exact:true})).toBeVisible()
  await expect(dialog.getByText(/Scheduled execution is not available yet/)).toBeVisible()
  await dialog.getByLabel('Recurring task',{exact:true}).fill('Prepare a morning brief')
  await dialog.getByLabel('Daily time',{exact:true}).fill('08:30');await dialog.getByLabel('Timezone',{exact:true}).fill('UTC')
  const bounds=await dialog.boundingBox();expect(bounds!.x+bounds!.width).toBeCloseTo(page.viewportSize()!.width,0)
  if(test.info().project.name==='mobile'){await dialog.getByRole('button',{name:'Save settings',exact:true}).press('Tab');await expect(dialog.getByRole('button',{name:'Back to bot settings',exact:true})).toBeFocused()}
  await dialog.getByRole('button', { name: 'Save settings' }).click()
  await expect(dialog).toHaveCount(0)
  expect(session.meta).toMatchObject({ group: 'Work', labels: ['daily','research'], botColor:'purple', bubbleColor:'purple',routineDraft:{prompt:'Prepare a morning brief',time:'08:30',timezone:'UTC',enabled:false} })
  await draft.fill('/rename Updated bot'); await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.conversation-header')).toContainText('Updated bot')
  expect(prompts).toEqual([])
  if(test.info().project.name==='mobile')await page.getByRole('button', {name:'Open bot menu'}).click()
  await expect(page.getByRole('navigation', { name:'Sessions' })).toContainText('Work')
  await expect(page.getByRole('navigation', { name:'Sessions' })).toContainText('#research')
})
test('managed host transport recovery is ephemeral and lifecycle intent is revision checked', async ({ page }) => {
  const secret = 'rue_worker_' + 'a'.repeat(43)
  let worker:any={id:'11111111-1111-4111-8111-111111111111',name:'Mason',ownerSubject:'usr_test',desired:'active',revision:0,generation:0,status:'unconfirmed',createdAt:Date.now(),serverNow:Date.now(),lastSeenAt:null,leaseExpiresAt:null,health:null,managedAgentCount:0}
  const actions:any[]=[]
  await page.route('http://localhost:4097/workers',route=>{expect(route.request().method()).toBe('GET');return route.fulfill({json:{workers:[worker]}})})
  await page.route('http://localhost:4097/workers/*', async route => {
    const input = route.request().postDataJSON(); actions.push(input)
    expect(input.expectedRevision).toBe(worker.revision)
    worker = { ...worker, revision: worker.revision + 1, desired: input.action === 'drain' ? 'draining' : 'active' }
    return route.fulfill({ json: { worker,...(input.action==='rotate'?{secret}:{}) } })
  })
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('tab', { name: 'Hosts', exact: true }).click()
  await page.getByText('Manage host',{exact:true}).click();page.on('dialog',dialog=>dialog.accept())
  await page.getByRole('button',{name:'Rotate transport credential'}).click()
  await expect(page.getByLabel('Worker secret', { exact: true })).toHaveValue(secret)
  await expect(page.getByLabel('Worker secret', { exact: true })).toHaveAttribute('type','password')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(secret)
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click()
  await page.getByRole('tab', { name: 'Hosts', exact: true }).click()
  await expect(page.getByLabel('Worker secret', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('article', { name: 'Host Mason' })).toContainText('0 managed agents')
  await expect(page.getByRole('article', { name: 'Host Mason' })).toContainText('Not connected')
  await expect(page).toHaveScreenshot('rue-settings-hosts.png', { animations: 'disabled', fullPage: true })
  await page.getByText('Manage host', { exact: true }).click()
  await page.getByRole('button', { name: 'Drain host' }).click()
  await expect(page.getByRole('article', { name: 'Host Mason' })).toContainText('Draining')
  expect(actions).toEqual([{action:'rotate',expectedRevision:0},{action:'drain',expectedRevision:1}])
  await expect(page.getByRole('tabpanel', { name: 'Hosts', exact: true }).getByRole('link', { name: /Help & documentation/ })).toHaveAttribute('href', /#hosts$/)
  await page.route('http://localhost:4097/workers', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.getByRole('button', { name: 'Refresh hosts' }).click()
  await expect(page.getByText('Showing last-known hosts. Refresh to check their status.')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Host Mason' })).toContainText('0 managed agents')
  await expect(page.getByRole('button', { name: 'Activate host' })).toBeVisible()
})

test('key listing failure stays visible without unnecessarily blocking authorized issuance',async({page})=>{
 await page.route('http://localhost:4097/api-keys/owners',route=>route.fulfill({json:{owners:[{owner:{type:'self'},label:'Personal'}]}}))
 await page.route('http://localhost:4097/api-keys',route=>route.fulfill({status:503,json:{error:'tenancy_keys_unavailable'}}))
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('tab',{name:'API keys',exact:true}).click()
 await expect(page.getByRole('table',{name:'Tenancy API keys'})).toContainText('Keys could not be loaded')
 await expect(page.getByRole('alert')).toContainText('local keys are not substituted')
 await page.getByRole('button',{name:'Add new API key',exact:true}).click();await expect(page.getByRole('dialog',{name:'Create API key',exact:true})).toBeVisible()
})
test('Tenancy API keys use ownership, permission presets, shared controls and one-time reveal', async ({ page }) => {
  const secret='tnk_'+'k'.repeat(43);let key:any
  await page.route('http://localhost:4097/api-keys/owners',route=>route.fulfill({json:{owners:[{owner:{type:'self'},label:'Personal'},{owner:{type:'project',organizationId:'org_one',projectId:'project_one'},label:'Team / Development'}]}}))
  await page.route('http://localhost:4097/api-keys',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{keys:key?[key]:[]}})
    const input=route.request().postDataJSON();expect(input.owner).toEqual({type:'self'});expect(input.grants).toEqual(['rue:agents:execute','rue:hosts:enroll','rue:hosts:read']);expect(input.requestId).toMatch(/^[a-f0-9-]{36}$/)
    key={...input,id:'key_one',service:'rue',createdAt:Date.now(),revokedAt:null};return route.fulfill({status:201,json:{...key,token:secret}})
  })
  await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('tab',{name:'API keys',exact:true}).click();await page.getByRole('button',{name:'Add new API key',exact:true}).click()
  const modal=page.getByRole('dialog',{name:'Create API key',exact:true});await expect(modal.getByRole('checkbox')).toHaveCount(8)
  await expect(modal.getByRole('button',{name:'Create key',exact:true})).toBeDisabled()
  await modal.getByLabel('Key name').fill('Mason automation');await modal.getByRole('tab',{name:'All',exact:true}).click();await expect(modal.getByRole('checkbox',{checked:true})).toHaveCount(8)
  await modal.getByRole('checkbox',{name:'Manage MCP tools'}).uncheck();await expect(modal.getByRole('tab',{name:'Restricted',exact:true})).toHaveAttribute('aria-selected','true')
  await modal.getByRole('tab',{name:'Enrollment',exact:true}).click();await expect(modal.getByRole('checkbox',{checked:true})).toHaveCount(3)
  await expect(modal).toHaveScreenshot('rue-create-api-key.png',{animations:'disabled'})
  await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Add new API key',exact:true}).click();await modal.getByLabel('Key name').fill('Mason automation');await modal.getByRole('tab',{name:'Enrollment',exact:true}).click();await modal.getByRole('button',{name:'Create key',exact:true}).click()
  const reveal=page.getByRole('dialog',{name:'API key created',exact:true});await expect(reveal.getByLabel('API key',{exact:true})).toHaveValue(secret);await expect(reveal.getByLabel('API key',{exact:true})).toHaveAttribute('type','password');await reveal.getByRole('button',{name:'Done',exact:true}).click()
  await expect(page.getByRole('row').filter({hasText:'Mason automation'})).toContainText('3 permissions');expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(secret)
})

test('project-owned key issuance retries without duplicating keys or recovering a secret',async({page})=>{
 const requests:any[]=[];const project={type:'project',organizationId:'org_one',projectId:'project_one'}
 await page.route('http://localhost:4097/api-keys**',async route=>{
  if(route.request().url().endsWith('/owners'))return route.fulfill({json:{owners:[{owner:{type:'self'},label:'Personal'},{owner:project,label:'Team / Development'}]}})
  if(route.request().method()==='GET')return route.fulfill({json:{keys:[]}})
  const input=route.request().postDataJSON();requests.push(input);expect(input.owner).toEqual(project)
  if(requests.length===1)return route.abort('failed')
  return route.fulfill({json:{...input,id:'key_project',service:'rue',createdAt:Date.now(),revokedAt:null}})
 })
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('tab',{name:'API keys',exact:true}).click();await page.getByRole('button',{name:'Add new API key',exact:true}).click()
 const modal=page.getByRole('dialog',{name:'Create API key',exact:true});await modal.getByLabel('Key name').fill('Project automation');await modal.getByRole('combobox',{name:'Key owner'}).click();await page.getByRole('option',{name:'Team / Development'}).click();await modal.getByRole('button',{name:'Create key',exact:true}).click();await expect(modal.getByRole('alert')).toContainText('Retry uses the same request')
 await modal.getByRole('button',{name:'Create key',exact:true}).click();await expect(page.getByRole('dialog',{name:'API key created',exact:true})).toContainText('secret cannot be recovered');expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);await expect(page.getByLabel('API key',{exact:true})).toHaveCount(0)
})

test('adding a host uses the same Tenancy key rather than a second enrollment-key form',async({page})=>{
 await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('tab',{name:'Hosts',exact:true}).click();await page.getByRole('button',{name:'Add new host'}).click()
 const setup=page.getByRole('region',{name:'Host setup'});await expect(setup).toContainText('Enrollment preset');await expect(setup).toContainText('rue-worker enroll-key');await expect(setup).toContainText('RUE_API_KEY_FILE');await expect(page.getByRole('button',{name:'Enroll host',exact:true})).toHaveCount(0)
})

test('settings body reaches the top of its layout and the right and bottom dialog edges', async ({page}) => {
  await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Open settings'}).click()
  const dialog=page.getByRole('dialog'),frame=page.locator('.rue-settings-page-frame'),layout=page.locator('.rue-settings-layout')
  await expect(dialog).toBeVisible()
  const d=(await dialog.boundingBox())!,f=(await frame.boundingBox())!,l=(await layout.boundingBox())!
  expect(Math.abs(d.x-((await page.evaluate(()=>innerWidth))-d.x-d.width))).toBeLessThan(2)
  if ((page.viewportSize()?.width ?? 1000) > 640) expect(Math.abs(f.y-l.y)).toBeLessThan(2)
  else expect(f.y).toBeGreaterThan(l.y)
  expect(Math.abs(f.x+f.width-d.x-d.width)).toBeLessThan(2)
  expect(Math.abs(f.y+f.height-d.y-d.height)).toBeLessThan(2)
  await expect(page).toHaveScreenshot('rue-settings-flush-body.png',{animations:'disabled',fullPage:true})
  await page.getByRole('tab',{name:'Support',exact:true}).click();await expect(page.getByRole('tabpanel',{name:'Support',exact:true})).toBeVisible()
})
test('background health fetches do not flash the refresh or reconnect controls', async ({ page }) => {
  let hold = false, waiting = false, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('http://localhost:4097/session', route => route.fulfill({ json: [{ id: 'stable', title: 'Stable controls', agent: 'pi-terminal', ownerSubject: 'usr_test', meta: {}, createdAt: 1, updatedAt: 1 }] }))
  await page.route('http://localhost:4097/terminal/computers', async route => {
    if (hold) { waiting = true; await gate }
    await route.fulfill({ json: { computers: [{ id: 'stable_host', sessionId: 'stable', ownerSubject: 'usr_test', name: 'Laptop', status: 'offline', serverNow: Date.now(), lastSeenAt: Date.now() - 90000 }] } })
  })
  try {
    await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
    await page.getByRole('navigation', { name: 'Sessions' }).getByRole('button', { name: /Stable controls/ }).click()
    const controls = page.getByRole('region', { name: 'Remote connection' })
    const reconnect = controls.getByRole('button', { name: 'Reconnect', exact: true })
    await expect(reconnect).toBeVisible()
    const node = await reconnect.elementHandle()
    hold = true
    await expect.poll(() => waiting).toBe(true)
    await page.getByLabel('Workspace options').click()
    const refresh = page.locator('.workspace-menu').getByRole('button', { name: 'Refresh',exact:true })
    await expect(refresh).toBeEnabled()
    expect(await refresh.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    expect(await node!.evaluate(el => el.isConnected)).toBe(true)
    release()
  } finally { release() }
})

test('browser clock skew does not turn a healthy server lease into a reconnect action', async ({ page }) => {
  await page.clock.install({ time: Date.now() + 600000 })
  await page.route('http://localhost:4097/session', route => route.fulfill({ json: [{ id: 'skew', title: 'Clock bot', agent: 'pi-terminal', ownerSubject: 'usr_test', meta: {}, createdAt: 1, updatedAt: 1 }] }))
  await page.route('http://localhost:4097/terminal/computers', route => route.fulfill({ json: { computers: [{ id: 'skew_host', sessionId: 'skew', ownerSubject: 'usr_test', name: 'Laptop', status: 'online', serverNow: Date.now(), lastSeenAt: Date.now(), leaseExpiresAt: Date.now() + 60000 }] } }))
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('navigation', { name: 'Sessions' }).getByRole('button', { name: /Clock bot/ }).click()
  const connection = page.getByRole('region', { name: 'Remote connection' })
  await expect(connection.locator('.remote-status-dot')).toHaveAttribute('data-state', 'connected')
  await expect(connection.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0)
  await refreshConversation(page)
  await expect(connection.locator('.remote-status-dot')).toHaveAttribute('data-state', 'connected')
  await expect(connection.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0)
})

test('merged agent header exposes connection diagnostics, retries and stale health without a banner', async ({page}) => {
  let status='online',lastSeenAt=Date.now(),fail=false,leaseExpiresAt=Date.now()+60000
  const health={uploadFailures:0,retries:3,lastUploadAt:Date.now(),pendingCount:3,pendingBytes:200,pollLatencyMs:12}
  await page.route('http://localhost:4097/session',r=>r.fulfill({json:[{id:'remote_status',title:'Status bot',agent:'pi-terminal',ownerSubject:'usr_test',meta:{},createdAt:1,updatedAt:1}]}))
  await page.route('http://localhost:4097/terminal/computers',r=>fail?r.fulfill({status:503,json:{error:'Unavailable'}}):r.fulfill({json:{computers:[{id:'computer_status',sessionId:'remote_status',ownerSubject:'usr_test',name:'Workstation',remoteEnabled:true,status,lastSeenAt,relayProtocol:2,leaseExpiresAt,health}]}}))
  await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Status bot/}).click()
  const banner=page.getByRole('region',{name:'Remote connection'}),dot=banner.locator('.remote-status-dot'),refresh={click:()=>refreshConversation(page)}
  await expect(dot).toHaveAttribute('data-state','connected');await expect(banner).toContainText('Connected')
  await expect(banner.getByRole('button',{name:'Reconnect',exact:true})).toHaveCount(0)
  await expect(page.locator('.remote-chat-banner')).toHaveCount(0)
  await expect(page.locator('.conversation-header .agent-connection-controls')).toHaveCount(1)
  await banner.getByRole('button',{name:'Connection details: Connected',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'Connection details'})).toContainText('3 (200 bytes)')
  await page.getByRole('button',{name:'Close dialog'}).click()
  health.uploadFailures=2;await refresh.click()
  await expect(dot).toHaveAttribute('data-state','intermittent');await expect(banner).toContainText('Retrying output upload')
  health.uploadFailures=0
  lastSeenAt=Date.now()-25000;await refresh.click()
  await expect(dot).toHaveAttribute('data-state','intermittent');await expect(banner).toContainText('Heartbeat delayed')
  await expect(banner.getByRole('button',{name:'Reconnect',exact:true})).toHaveCount(0)
  status='offline';await refresh.click()
  await expect(dot).toHaveAttribute('data-state','disconnected');await expect(banner.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible()
  const reconnectNode = await banner.getByRole('button',{name:'Reconnect',exact:true}).elementHandle()
  fail=true;await refresh.click()
  await expect(dot).toHaveAttribute('data-state','intermittent');await expect(banner).toContainText('Health check failed')
  await expect(banner.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible()
  expect(await reconnectNode!.evaluate(node => node.isConnected)).toBe(true)
  fail=false;status='online';lastSeenAt=Date.now();await refresh.click()
  await expect(dot).toHaveAttribute('data-state','connected')
  leaseExpiresAt=Date.now()-1;await refresh.click()
  await expect(dot).toHaveAttribute('data-state','intermittent')
  await expect(banner.getByRole('button',{name:'Reconnect',exact:true})).toHaveCount(0)
})
test('composer primary action switches between voice and send without auto-sending speech', async ({ page }) => {
  await page.addInitScript(() => { (window as any).SpeechRecognition = class { onresult:any; onend:any; constructor(){ (window as any).__speech=this } start(){} stop(){ this.onend?.() } abort(){ this.onend?.() } } })
  await attachmentBot(page)
  const draft = page.getByRole('textbox', { name: 'Message', exact: true }), mic = page.getByRole('button', { name: 'Start dictation' }), send = page.getByRole('button', { name: 'Send message' })
  const voice = page.getByRole('button', { name: 'Start voice recording' })
  await expect(mic).toBeVisible(); await expect(voice).toBeVisible(); await expect(send).toHaveCount(0)
  const voiceBounds = await voice.boundingBox(), micBounds = await mic.boundingBox()
  expect(micBounds!.x + micBounds!.width).toBeLessThan(voiceBounds!.x)
  expect(micBounds!.y).toBe(voiceBounds!.y)
  await draft.fill('   '); await expect(send).toHaveCount(0)
  await draft.fill('Hello'); await expect(send).toBeEnabled(); await expect(mic).not.toHaveClass(/composer-primary-voice/)
  expect((await send.boundingBox())!.x).toBe(voiceBounds!.x)
  await draft.fill(''); await voice.click()
  await page.evaluate(() => (window as any).__speech.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Voice draft' } }] }))
  await expect(send).toHaveCount(0); await expect(page.getByRole('button', { name: 'Stop dictation' })).toBeVisible()
  await page.getByRole('button', { name: 'Stop voice recording' }).click()
  await expect(send).toBeEnabled(); await expect(draft).toHaveValue('Voice draft.')
  await expect(mic).toBeVisible(); await expect(voice).toHaveCount(0)
  await draft.fill(''); await expect(mic).toBeVisible(); await expect(voice).toBeVisible()
  await page.getByLabel('Attach files', { exact: true }).setInputFiles({ name: 'only-file.txt', mimeType: 'text/plain', buffer: Buffer.from('file') })
  await expect(send).toBeEnabled()
})
test('composer attachment shortcut opens the picker directly; plus menu searches real actions', async ({ page }) => {
  await attachmentBot(page)
  const plus = page.getByRole('button', { name: 'Chat actions', exact: true }), attachment = page.getByRole('button', { name: 'Add attachment', exact: true })
  await expect(plus).toBeVisible(); await expect(attachment).toBeVisible()
  const a = await plus.boundingBox(), b = await attachment.boundingBox()
  expect(b!.x).toBeGreaterThan(a!.x); expect(b!.y).toBe(a!.y)
  const chooser = page.waitForEvent('filechooser'); await attachment.click()
  await (await chooser).setFiles({ name: 'direct.txt', mimeType: 'text/plain', buffer: Buffer.from('direct upload') })
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toContainText('direct.txt')
  const menu = page.getByRole('region', { name: 'Chat actions', exact: true })
  await expect(menu).not.toBeVisible(); await plus.click()
  await expect(menu.getByRole('button', { name: 'Add photos & files' })).toBeVisible()
  await expect(menu).toContainText('Upload photos, videos or files from your device')
  const viewport = page.viewportSize()!
  await expect.poll(async () => { const bounds = (await menu.boundingBox())!; return bounds.x >= 0 && bounds.x + bounds.width <= viewport.width }).toBe(true)
  await expect(page).toHaveScreenshot('rue-composer-actions.png', { animations: 'disabled', fullPage: true })
  const search = menu.getByRole('textbox', { name: 'Search chat actions' })
  await search.fill('remote'); await expect(menu.getByRole('button')).toHaveCount(1)
  await search.press('Enter'); await expect(menu).toBeVisible()
  await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible(); await expect(plus).toBeFocused()
  await plus.click(); await expect(search).toHaveValue('')
})
test('composer plus actions and command info open anchored non-modal popovers', async ({page}) => {
  await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Tools bot');await page.getByRole('button',{name:'Add bot',exact:true}).click()
  await expect(page.getByRole('dialog', { name: 'Add new bot' })).toHaveCount(0)
  await expect(page.locator('.conversation-header')).toContainText('Tools bot')
  const plus=page.getByRole('button',{name:'Chat actions',exact:true}),info=page.getByRole('button',{name:'Rue commands',exact:true})
  await expect(plus).toBeVisible();await expect(info).toBeVisible()
  const a=await plus.boundingBox(),b=await info.boundingBox();expect(a!.x+a!.width).toBeLessThan(b!.x);expect(a!.y).toBe(b!.y)
  await info.click()
  const help=page.getByRole('region',{name:'Rue commands'})
  await expect(help).toBeVisible();await expect(help).toContainText('/rename NAME')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await help.boundingBox())!.y+(await help.boundingBox())!.height).toBeLessThan(b!.y)
  await expect(page).toHaveScreenshot('rue-composer-info.png',{animations:'disabled',fullPage:true})
  await page.keyboard.press('Escape');await expect(help).not.toBeVisible();await expect(info).toBeFocused()
  await plus.click();await expect(page.getByRole('region',{name:'Chat actions'})).toBeVisible()
  await page.getByRole('region',{name:'Chat actions'}).getByRole('button',{name:'Settings',exact:true}).click()
  await expect(page.getByRole('region',{name:'Chat actions'})).not.toBeVisible()
  await expect(page.getByRole('complementary',{name:'Settings'})).toBeVisible()
  await page.keyboard.press('Escape')
  const draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('/help');if(test.info().project.name==='mobile')await page.getByRole('button',{name:'Send message'}).click();else await draft.press('Enter')
  await expect(help).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.conversation-header').click();await expect(help).not.toBeVisible()
})
test('dictation starts without confirmation, remains a draft, and stops on session navigation', async ({ page }) => {
  let submitted=0
  await page.route('http://localhost:4097/session/*/message',route=>{submitted++;return route.fallback()})
  await page.addInitScript(() => { (window as any).SpeechRecognition = class { continuous=false;interimResults=false;lang='';onresult:any;onend:any;onerror:any;constructor(){(window as any).__speech=this}start(){}stop(){this.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:'and more!'}}]});this.onend?.()}abort(){(window as any).__speechAborted=true;this.onend?.()} } })
  await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await page.getByRole('button', { name: 'Create first bot' }).click(); await page.getByLabel('Bot name').fill('Voice bot'); await page.getByRole('button', { name: 'Add bot', exact: true }).click()
  await page.locator('.composer').evaluate(el=>el.style.setProperty('--color-5','rgb(80, 81, 82)'))
  await expect(page.getByRole('button',{name:'Start dictation'})).toHaveCSS('border-top-color','rgb(80, 81, 82)')
  await expect(page.getByRole('button',{name:'Start dictation'})).toHaveCSS('border-top-style','solid')
  await page.locator('.composer').evaluate(el=>el.style.removeProperty('--color-5'))
  await page.getByRole('button', { name: 'Start dictation' }).click()
  const draft=page.getByRole('textbox', { name: 'Message', exact: true })
  await expect(page.getByRole('button',{name:'Stop dictation'})).toHaveCSS('border-top-width','1px')
  await expect(page.locator('.dictation-wave')).toBeVisible()
  await expect(page.getByRole('button',{name:'Stop dictation'})).toHaveCSS('background-color', await page.evaluate(()=>{const el=document.createElement('span');el.style.color='var(--rue-primary)';document.body.append(el);const color=getComputedStyle(el).color;el.remove();return color}))
  await expect(page.locator('.dictation-wave>span').first()).toHaveCSS('animation-name','dictation-listen')
  await page.emulateMedia({reducedMotion:'reduce'})
  await expect(page.locator('.dictation-wave>span').first()).toHaveCSS('animation-name','none')
  await page.emulateMedia({reducedMotion:'no-preference'})
  await expect(page.locator('.dictation-indicator')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Send message' })).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Stop voice recording'})).toHaveClass(/composer-primary-voice/)
  await expect(page.getByRole('button',{name:'Stop dictation'})).toBeVisible()
  await page.evaluate(() => (window as any).__speech.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'Dictate' } }] }))
  await expect(draft).toHaveValue('Dictate')
  await page.evaluate(() => (window as any).__speech.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'Dictated draft' } }] }))
  await expect(draft).toHaveValue('Dictated draft')
  // Repeated final results must replace, never duplicate, the interim text.
  await page.evaluate(() => {const event={ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Dictated draft' } }] };(window as any).__speech.onresult(event);(window as any).__speech.onresult(event)})
  await expect(draft).toHaveValue('Dictated draft')
  await page.evaluate(() => (window as any).__speech.onend())
  await page.evaluate(() => (window as any).__speech.onresult({ resultIndex: 0, results: [{isFinal:false,0:{transcript:'and more'}}] }))
  await expect(draft).toHaveValue('Dictated draft and more')
  await draft.press('Enter');expect(submitted).toBe(0)
  await page.getByRole('button', { name: 'Stop dictation' }).click()
  await expect(draft).toHaveValue('Dictated draft and more!')
  expect(submitted).toBe(0)
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  await expect(draft).toBeEditable()
  await draft.fill('Existing text')
  await page.getByRole('button', { name: 'Start dictation' }).click()
  await page.evaluate(() => (window as any).__speech.onresult({ resultIndex:0,results:[{isFinal:false,0:{transcript:'long speech '.repeat(80)}}] }))
  await expect(draft).toHaveValue('Existing text '+'long speech '.repeat(80).trim())
  await expect.poll(()=>draft.evaluate(el=>el.clientHeight)).toBeGreaterThan(44)
  expect(await draft.evaluate(el=>el.scrollTop)).toBeGreaterThan(0)
  await expect(page).toHaveScreenshot('rue-dictation-listening.png',{animations:'disabled',fullPage:true})
  if(test.info().project.name==='mobile')await page.getByRole('button', {name:'Open bot menu'}).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/login/)
  await expect(page.getByText('Listening…', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__speechAborted)).toBe(true)
})
test('dictation replaces growing phrase hypotheses without duplicating words', async ({page}) => {
  await page.addInitScript(() => {
    (window as any).SpeechRecognition = class {
      onresult:any; onend:any; onerror:any
      constructor(){(window as any).__speech=this}
      start(){} stop(){this.onend?.()} abort(){this.onend?.()}
    }
  })
  await page.goto('/login')
  await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Create first bot'}).click()
  await page.getByLabel('Bot name').fill('Phrase regression')
  await page.getByRole('button',{name:'Add bot',exact:true}).click()
  const draft=page.getByRole('textbox',{name:'Message',exact:true})
  await draft.fill('Existing draft:')
  await page.getByRole('button',{name:'Start dictation'}).click()
  for(const transcript of ['listen','listen to','listen to me','listen to me','listen to me, microphone']) {
    await page.evaluate(transcript => (window as any).__speech.onresult({
      resultIndex:0,results:[{isFinal:false,0:{transcript}}],
    }),transcript)
    await expect(draft).toHaveValue(`Existing draft: ${transcript}`)
  }
  // A repeated final event is not a second utterance. A new recognizer after
  // onend starts the next utterance; intentional repeated words stay intact.
  for(let repeat=0;repeat<2;repeat++) {
    await page.evaluate(() => (window as any).__speech.onresult({resultIndex:0,results:[
      {isFinal:true,0:{transcript:'listen to me, microphone'}},
    ]}))
    await expect(draft).toHaveValue('Existing draft: listen to me, microphone')
  }
  await page.evaluate(() => (window as any).__speech.onend())
  await page.evaluate(() => (window as any).__speech.onresult({resultIndex:0,results:[
    {isFinal:true,0:{transcript:'very very clear'}},
  ]}))
  await page.getByRole('button',{name:'Stop dictation'}).click()
  await expect(draft).toHaveValue('Existing draft: listen to me, microphone very very clear.')
})

test('dictation handles cumulative multi-slot results and ignores callbacks from a finished utterance', async ({page}) => {
  await page.addInitScript(() => {
    (window as any).__speechStarts = 0
    ;(window as any).SpeechRecognition = class {
      onresult:any; onend:any; onerror:any
      constructor(){(window as any).__speech=this}
      start(){(window as any).__speechStarts++}
      stop(){this.onend?.()} abort(){this.onend?.()}
    }
  })
  await page.goto('/login'); await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Create first bot'}).click()
  await page.getByLabel('Bot name').fill('Cumulative speech')
  await page.getByRole('button',{name:'Add bot',exact:true}).click()
  const draft=page.getByRole('textbox',{name:'Message',exact:true})
  await draft.fill('Draft:')
  await page.getByRole('button',{name:'Start dictation'}).click()
  expect(await page.evaluate(() => (window as any).__speech.continuous)).toBe(false)
  const phrase='we want to tackle the remaining scope which includes the tool output images prior history and private reasoning'
  const words=phrase.split(' ')
  // Reproduce the reported shape: each slot retains an older cumulative phrase,
  // with repeated slots and even browsers marking those hypotheses final.
  for(const isFinal of [false,true]) {
    const transcripts:string[]=[]
    for(let index=1;index<=words.length;index++) {
      const text=words.slice(0,index).join(' ')
      transcripts.push(text,text)
      await page.evaluate(({transcripts,isFinal}) => (window as any).__speech.onresult({
        resultIndex:transcripts.length-1,
        results:transcripts.map(transcript=>({isFinal,0:{transcript}})),
      }),{transcripts,isFinal})
      await expect(draft).toHaveValue(`Draft: ${text}`)
    }
  }
  await page.evaluate(() => {
    const previous=(window as any).__speech
    const late=previous.onresult, lateEnd=previous.onend
    previous.onend()
    late({resultIndex:0,results:[{isFinal:true,0:{transcript:'stale duplicate'}}]})
    lateEnd()
  })
  expect(await page.evaluate(() => (window as any).__speechStarts)).toBe(2)
  await expect(draft).toHaveValue(`Draft: ${phrase}`)
  await page.evaluate(() => (window as any).__speech.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'very very clear'}}]}))
  await page.getByRole('button',{name:'Stop dictation'}).click()
  await expect(draft).toHaveValue(`Draft: ${phrase} very very clear.`)
  expect(await page.evaluate(() => (window as any).__speechStarts)).toBe(2)
  await expect(page.getByRole('button',{name:'Start dictation'})).toBeVisible()
})

for (const attached of [false, true]) test(`dictation stops immediately when editing ${attached ? 'an attachment draft' : 'plain text'} and ignores late speech`, async ({ page }) => {
  await page.addInitScript(() => { (window as any).__speechStarts = 0; (window as any).SpeechRecognition = class {
    onresult:any; onend:any; onerror:any
    constructor(){ (window as any).__speech = this }
    start(){ (window as any).__speechStarts++ }
    stop(){} // Simulate a browser that never supplies a final result.
    abort(){ (window as any).__speechAborted = true; this.onend?.() }
  } })
  await attachmentBot(page)
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  await draft.fill('Draft ')
  if (attached) await page.getByLabel('Attach files', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') })
  if (attached) await expect(draft).toContainText('notes.txt')
  await page.getByRole('button', { name: 'Start dictation' }).click()
  await page.evaluate(() => {
    const speech = (window as any).__speech
    ;(window as any).__lateSpeech = speech.onresult; (window as any).__lateEnd = speech.onend
    speech.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'spoken words' } }] })
  })
  if (test.info().project.name === 'mobile') await draft.tap(); else await draft.click()
  await expect(page.getByRole('button', { name: 'Stop dictation' })).toHaveCount(0)
  await expect(draft).toBeEditable()
  expect(await page.evaluate(() => (window as any).__speechAborted)).toBe(true)
  await draft.press('End'); await page.keyboard.insertText(' edited')
  const text = () => draft.evaluate(el => el instanceof HTMLTextAreaElement ? el.value : el.textContent)
  const edited = await text(); expect(edited).toContain('edited')
  await page.evaluate(() => {
    ;(window as any).__lateSpeech({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late overwrite' } }] })
    ;(window as any).__lateEnd()
  })
  expect(await text()).toBe(edited)
  expect(await page.evaluate(() => (window as any).__speechStarts)).toBe(1)
  await expect(page.getByRole('button', { name: 'Undo punctuation cleanup' })).toHaveCount(0)
})

test('dictation cleans punctuation quietly on explicit stop and stays ready through silence', async ({page}) => {
  await page.addInitScript(() => {
    (window as any).__speechStarts = 0
    ;(window as any).SpeechRecognition = class {
      onresult:any; onend:any; onerror:any
      constructor(){(window as any).__speech=this}
      start(){(window as any).__speechStarts++}
      stop(){this.onend?.()} abort(){this.onend?.()}
    }
  })
  await page.goto('/login'); await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Create first bot'}).click()
  await page.getByLabel('Bot name').fill('Natural dictation')
  await page.getByRole('button',{name:'Add bot',exact:true}).click()
  const draft=page.getByRole('textbox',{name:'Message',exact:true})
  await draft.fill('Typed draft:')
  await page.getByRole('button',{name:'Start dictation'}).click()
  await page.evaluate(() => (window as any).__speech.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'hello , world'}}]}))
  await expect(draft).toHaveValue('Typed draft: hello, world')
  await page.evaluate(() => (window as any).__speech.onend())
  await page.evaluate(() => { const s=(window as any).__speech; s.onerror({error:'no-speech'}); s.onend() })
  await expect.poll(() => page.evaluate(() => (window as any).__speechStarts)).toBe(3)
  await expect(page.getByRole('button',{name:'Stop dictation'})).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button',{name:'Stop dictation'}).click()
  await expect(draft).toHaveValue('Typed draft: hello, world.')
  await expect(page.getByRole('button',{name:'Undo punctuation cleanup'})).toHaveCount(0)
  await draft.fill('')
  await page.getByRole('button',{name:'Start dictation'}).click()
  await page.evaluate(() => (window as any).__speech.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'is this ready?'}}]}))
  await page.getByRole('button',{name:'Stop dictation'}).click()
  await expect(draft).toHaveValue('Is this ready?')
})

test('unsupported browsers keep typing available without offering broken dictation', async ({page}) => {
  await page.addInitScript(()=>{(window as any).SpeechRecognition=undefined;(window as any).webkitSpeechRecognition=undefined})
  await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Typed bot');await page.getByRole('button',{name:'Add bot',exact:true}).click()
  await expect(page.getByRole('button',{name:'Start dictation'})).toBeDisabled()
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEditable()
  await expect(page.locator('.dictation-wave')).toHaveCount(0)
})
test('dictation errors and backgrounding stop recording without losing the draft', async ({page}) => {
  await page.addInitScript(()=>{(window as any).SpeechRecognition=class {onresult:any;onend:any;onerror:any;constructor(){(window as any).__speech=this}start(){if((window as any).__failStart)throw Error('start failed')}stop(){this.onend?.()}abort(){this.onend?.()}}})
  await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Voice errors');await page.getByRole('button',{name:'Add bot',exact:true}).click()
  const draft=page.getByRole('textbox',{name:'Message',exact:true}),start=page.getByRole('button',{name:'Start dictation'})
  await draft.fill('Keep this')
  await start.click()
  await page.evaluate(()=>{const s=(window as any).__speech;(window as any).__lateResult=s.onresult;(window as any).__lateEnd=s.onend;s.onerror({error:'not-allowed'})})
  await expect(page.getByRole('alert')).toContainText('permission was denied')
  await expect(draft).toHaveValue('Keep this');await expect(draft).toBeEditable()
  await expect(page.getByRole('button',{name:'Send message'})).toBeEnabled()
  await start.click()
  await page.evaluate(()=>{(window as any).__lateResult({resultIndex:0,results:[{isFinal:true,0:{transcript:'stale'}}]});(window as any).__lateEnd()})
  await expect(page.getByRole('button',{name:'Stop dictation'})).toBeVisible();await expect(draft).toHaveValue('Keep this')
  await page.evaluate(()=>{(window as any).__speech.stop=()=>{}})
  await page.getByRole('button',{name:'Stop dictation'}).click()
  await expect(start).toBeVisible();await expect(draft).toBeEditable()
  await start.click()
  await page.evaluate(()=>{(window as any).__speech.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'live words'}}]});Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete (document as any).hidden})
  await expect(start).toBeVisible();await expect(draft).toHaveValue('Keep this live words')
  await page.evaluate(()=>{(window as any).__failStart=true})
  await start.click()
  await expect(page.getByRole('alert')).toContainText('could not start')
  await expect(start).toBeVisible();await expect(draft).toHaveValue('Keep this live words')
})
test('selecting or reselecting a bot opens at the bottom after delayed history and layout changes', async ({ page }) => {
  let release!: () => void
  const historyReady = new Promise<void>(resolve => { release = resolve })
  const sessions = ['Alpha', 'Beta'].map(title => ({ id: title.toLowerCase(), title, ownerSubject: 'usr_test', agent: null, meta: {}, createdAt: 1, updatedAt: 1 }))
  await page.route('http://localhost:4097/session', route => route.fulfill({ json: sessions }))
  await page.route('http://localhost:4097/session/*/messages', route => {
    const id = new URL(route.request().url()).pathname.split('/')[2]!
    return route.fulfill({ json: Array.from({ length: 25 }, (_, i) => ({ id: `${id}-${i}`, sessionId: id, role: 'assistant', time: 1, seq: i, meta: {} })) })
  })
  await page.route('http://localhost:4097/session/*/parts', async route => {
    const id = new URL(route.request().url()).pathname.split('/')[2]!
    if (id === 'alpha') await historyReady
    await route.fulfill({ json: Array.from({ length: 25 }, (_, i) => ({ id: `p-${id}-${i}`, sessionId: id, messageId: `${id}-${i}`, type: 'text', seq: 0, payload: { text: `${id} reply ${i}: ` + 'Long history paragraph. '.repeat(20) } })) })
  })
  const viewport = page.locator('.chat-scroll-viewport')
  const atBottom = () => expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
  const select = async (name: string) => {
    const back = page.getByRole('button', { name: 'Open bot menu' })
    if (test.info().project.name === 'mobile' && await back.isVisible()) await back.click()
    await page.getByRole('navigation', { name: 'Sessions' }).getByRole('button', { name: new RegExp(name) }).click()
  }
  const scrollUp = async () => {
    await viewport.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
    await expect(page.getByRole('button', { name: 'Latest messages' })).toBeVisible()
  }
  try {
    await page.goto('/login'); await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
    await select('Alpha'); release()
    await expect(page.getByText(/^alpha reply 24:/)).toBeVisible(); await atBottom()
    // Simulate late media sizing without changing any query data.
    await page.locator('.message-row').last().evaluate(el => { const media = document.createElement('div'); media.style.height = '280px'; el.querySelector('.message-bubble')!.append(media) })
    await atBottom(); await scrollUp()
    await select('Beta'); await expect(page.getByText(/^beta reply 24:/)).toBeVisible(); await atBottom()
    await scrollUp(); await select('Alpha'); await atBottom() // cached history
    await scrollUp(); await select('Alpha'); await atBottom() // same bot / mobile reopening
    await expect(page.getByRole('button', { name: 'Latest messages' })).toHaveCount(0)
  } finally { release() }
})

test('incoming replies preserve reading position until jumping to latest', async ({ page }) => {
  let release!:()=>void;const ready=new Promise<void>(r=>{release=r});let extra=false
  const session={id:'ses_scroll',title:'Long conversation',ownerSubject:'usr_test',agent:null,meta:{},createdAt:1,updatedAt:1}
  await page.route('http://localhost:4097/session',r=>r.fulfill({json:[session]}))
  await page.route('http://localhost:4097/session/ses_scroll/messages',r=>r.fulfill({json:Array.from({length:extra?31:30},(_,i)=>({id:`m${i}`,sessionId:session.id,role:'assistant',time:1,meta:{},seq:i}))}))
  await page.route('http://localhost:4097/session/ses_scroll/parts',r=>r.fulfill({json:Array.from({length:extra?31:30},(_,i)=>({id:`p${i}`,sessionId:session.id,messageId:`m${i}`,type:'text',seq:0,payload:{text:i===30?'Brand new reply':`Message ${i}: `+'A long paragraph for scroll testing. '.repeat(10)}}))}))
  await page.route('http://localhost:4097/event',async r=>{await ready;await r.fulfill({contentType:'text/event-stream',body:'data: {"id":0,"type":"hello","time":1,"payload":{}}\n\n'})})
  try {
    await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click()
    await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Long conversation/}).click()
    await expect(page.locator('.message-row')).toHaveCount(30)
    const viewport=page.locator('.chat-scroll-viewport')
    await expect.poll(()=>viewport.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(2)
    await viewport.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'))})
    await expect(page.getByRole('button',{name:'Latest messages'})).toBeVisible()
    const column=await page.locator('.message-column').boundingBox(),overlay=await page.locator('.jump-latest-container').boundingBox()
    expect(Math.abs(column!.x-overlay!.x)).toBeLessThan(2);expect(Math.abs(column!.width-overlay!.width)).toBeLessThan(2)
    extra=true;release()
    await expect(page.getByText('Brand new reply',{exact:true})).toHaveCount(1)
    expect(await viewport.evaluate(el=>el.scrollTop)).toBeLessThan(100)
    await page.getByRole('button',{name:'Latest messages'}).click()
    await expect(page.getByText('Brand new reply',{exact:true})).toBeInViewport()
  } finally {release()}
})
test('switching accounts discards the prior account query cache and late replies', async ({ page }) => {
  let release!:()=>void;const pending=new Promise<void>(r=>{release=r})
  await page.route('http://localhost:4097/session',r=>r.fulfill({json:r.request().headers().authorization==='Bearer keyname-test-token'?[{id:'private',title:'Previous private bot',ownerSubject:'usr_test',agent:null,meta:{},createdAt:1,updatedAt:1}]:[]}))
  await page.route('http://localhost:4097/session/private/parts',async r=>{await pending;await r.fulfill({json:[{id:'p',messageId:'m',sessionId:'private',type:'text',seq:0,payload:{text:'Previous private reply'}}]})})
  try {
    await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click()
    await expect(page.getByRole('navigation',{name:'Sessions'})).toContainText('Previous private bot')
    await page.getByRole('button',{name:'Sign out'}).click();await expect(page).toHaveURL(/login/)
    await page.evaluate(()=>{const user={subject:'usr_other',userEmail:'other@example.com',principalType:'user'};const client=window.Keyname as any;client.currentUser=async()=>user;client.getAccessToken=async()=> 'other-token';client.signIn=async()=>({token:'other-token',record:user})})
    await page.getByRole('button',{name:/Sign in with Keyname/}).click()
    await expect(page.getByText('other@example.com')).toBeVisible()
    release()
    await expect(page.getByText('Your Rue crew starts here.')).toBeVisible()
    await expect(page.getByText('Previous private bot')).toHaveCount(0)
    await expect(page.getByText('Previous private reply')).toHaveCount(0)
  } finally {release()}
})
declare global{interface Window{__keynameMode?:string}}
