import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const viewport of [{width:1280,height:900},{width:412,height:915}])test(`drawer history, titles, header spacing and dark separators at ${viewport.width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const context=await browser.newContext({viewport}),page=await context.newPage(),agentId=randomUUID(),workerId=randomUUID(),connectionId='term_'+'a'.repeat(32)
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session={id:'ses_navigation',title:'Navigation bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{managedAgentId:agentId},agent:'pi-terminal',terminalConnectionId:connectionId,provider:'openai',model:'test',scopes:[],directory:null,parentId:null}
  const agent={id:agentId,workerId,sessionId:session.id,connectionId,name:session.title,desired:'running',observed:'running',revision:1,observedRevision:1,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:true,shareThinking:true}}
  await page.route(`${api}/**`,route=>{const path=new URL(route.request().url()).pathname,json=body=>route.fulfill({json:body})
   if(path==='/managed-agents')return json({agents:[agent]})
   if(path.endsWith('/operations'))return json({operations:[]});if(path.endsWith('/compactions'))return json({commands:[]})
   if(path===`/runtime-rollouts/agents/${agentId}/grant`)return json({ownerSubject:'usr_test',agentId,agentRevision:1,workerId,workerName:'Mason',connectionId,revision:0,enabled:false,expiresAt:null,updatedAt:null,serverNow:Date.now(),managerReady:true,audit:[]})
   if(path==='/workers')return json({workers:[{id:workerId,ownerSubject:'usr_test',name:'Mason',status:'online',desired:'active',revision:0,health:{capabilities:['managed-agents-v1','managed-filesystem-v1']}}]})
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}])
   if(path==='/session')return json([session]);if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path==='/terminal/computers')return json({computers:[]})
   if(path==='/provider-keys')return json({ownerSubject:'usr_test',keyStorageAvailable:true,keys:[]})
   if(path==='/provider-keys/catalog')return json({providers:[{id:'openai',name:'OpenAI',models:[{id:'test',name:'Test model'}]}]})
   if(path==='/device/register')return json({});if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Navigation bot/}).click()
  await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Settings',exact:true}).click()
  const panel=page.getByRole('complementary',{name:'Settings',exact:true}),header=panel.locator('.bot-settings-heading'),title=text=>header.getByRole('heading',{name:text,exact:true})
  await expect(title('Bot settings')).toBeVisible();await expect(header.getByRole('button',{name:/^Back /})).toHaveCount(0)
  await expect(header).toContainText('Navigation bot');await panel.getByLabel('Bot name',{exact:true}).fill('Unsaved navigation draft')
  await panel.getByRole('button',{name:'Actions',exact:true}).scrollIntoViewIfNeeded();const scroll=panel.locator('.rue-scroll-viewport'),savedScroll=await scroll.evaluate(el=>el.scrollTop)
  await panel.getByRole('button',{name:'Actions',exact:true}).click();await expect(title('Agent actions')).toBeVisible()
  await panel.getByRole('button',{name:'Change provider / model',exact:true}).click();const modal=page.getByRole('dialog',{name:'Change provider and model',exact:true});await expect(modal).toBeVisible();await modal.getByRole('button',{name:'Cancel',exact:true}).click();await expect(title('Agent actions')).toBeVisible()
  await panel.getByRole('button',{name:'Workspace',exact:true}).click();await expect(title('Workspace')).toBeVisible();await expect(header.getByRole('button',{name:'Back to agent actions',exact:true})).toBeVisible()
  const backBox=await header.getByRole('button',{name:'Back to agent actions',exact:true}).boundingBox(),titleBox=await title('Workspace').boundingBox();assert.ok(titleBox.x-backBox.x-backBox.width>=10);assert.ok(backBox.width>=44&&backBox.height>=44)
  await panel.getByRole('button',{name:'Actions',exact:true}).click();await expect(title('Agent actions')).toBeVisible()
  await panel.getByRole('button',{name:'Permissions',exact:true}).click();await expect(title('Permissions')).toBeVisible()
  for(const [back,expected] of [['agent actions','Agent actions'],['workspace','Workspace'],['agent actions','Agent actions'],['bot settings','Bot settings']]){await header.getByRole('button',{name:`Back to ${back}`,exact:true}).click();await expect(title(expected)).toBeVisible()}
  await expect(header.getByRole('button',{name:/^Back /})).toHaveCount(0);await expect(panel.getByLabel('Bot name',{exact:true})).toHaveValue('Unsaved navigation draft');assert.ok(Math.abs(await scroll.evaluate(el=>el.scrollTop)-savedScroll)<4)
  for(const theme of ['Rue','Grove','Midnight','Paper','Mono','Sunset','Ocean']){
   await page.locator('html').evaluate((el,theme)=>{el.dataset.theme=theme;el.dataset.mode='dark'},theme)
   const contrast=await panel.locator('hr').first().evaluate(el=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};const luminance=color=>rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);const line=luminance(getComputedStyle(el).backgroundColor),background=luminance(getComputedStyle(el.closest('.bot-settings-drawer')).backgroundColor);return (Math.max(line,background)+.05)/(Math.min(line,background)+.05)})
   assert.ok(contrast>=3,`${theme} separator contrast was ${contrast}`)
  }
  await page.locator('html').evaluate(el=>{el.dataset.theme='Rue';el.dataset.mode='light'})
  await expect(panel.locator('hr').first()).toHaveCSS('background-color','rgb(215, 215, 211)')
  await page.emulateMedia({reducedMotion:'reduce'})
  await panel.getByRole('button',{name:'Routines',exact:true}).click();await expect(title('Routine draft')).toBeVisible();await header.getByRole('button',{name:'Back to bot settings',exact:true}).click()
  await panel.getByRole('button',{name:'Connection',exact:true}).click();await expect(title('Connection details')).toBeVisible();await header.getByRole('button',{name:'Back to bot settings',exact:true}).click()
  await panel.getByRole('button',{name:'AI settings',exact:true}).click();await expect(title('AI settings')).toBeVisible();await header.getByRole('button',{name:'Back to bot settings',exact:true}).click()
  if(viewport.width>1000){
   await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Status',exact:true}).click();await expect(title('Agent status')).toBeVisible()
   await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Workspace',exact:true}).click();await expect(title('Workspace')).toBeVisible()
   await header.getByRole('button',{name:'Back to agent status',exact:true}).click();await expect(title('Agent status')).toBeVisible()
  }
  await header.getByRole('button',{name:'Close settings',exact:true}).click();await expect(panel).toHaveCount(0)
  await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Permissions',exact:true}).click();await expect(title('Permissions')).toBeVisible();await header.getByRole('button',{name:'Back to bot settings',exact:true}).click();await expect(title('Bot settings')).toBeVisible()
 }finally{await browser.close()}
})
