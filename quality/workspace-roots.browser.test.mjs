import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])for(const extended of [true,false])test(`workspace roots require capability and consent (${width}px, v2=${extended})`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const context=await browser.newContext({viewport:{width,height:915}}),page=await context.newPage(),agentId=randomUUID(),workerId=randomUUID(),writes=[]
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session={id:'ses_workspaces',title:'Workspace bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{managedAgentId:agentId},agent:'pi-terminal',terminalConnectionId:null,provider:'openai',model:'test',scopes:[],directory:null,parentId:null}
  const original={provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:true,shareThinking:false}
  let agent={id:agentId,workerId,sessionId:session.id,connectionId:null,name:session.title,desired:'running',observed:'running',revision:1,observedRevision:1,config:original}
  await page.route(`${api}/**`,route=>{const req=route.request(),path=new URL(req.url()).pathname,json=body=>route.fulfill({json:body})
   if(path===`/managed-agents/${agentId}`&&req.method()==='PATCH'){const input=req.postDataJSON();writes.push(input);agent={...agent,config:input.config,revision:2,desired:'stopped'};return json({agent,operation:{id:'fixture-operation',agentId,revision:2,action:'configure',state:'queued',createdAt:Date.now(),updatedAt:Date.now()}})}
   if(path==='/managed-agents')return json({agents:[agent]})
   if(path.endsWith('/operations'))return json({operations:[]});if(path.endsWith('/compactions'))return json({commands:[]})
   if(path==='/workers')return json({workers:[{id:workerId,ownerSubject:'usr_test',name:'Mason',status:'online',desired:'active',revision:0,health:{capabilities:['managed-agents-v1','managed-filesystem-v1',...(extended?['managed-filesystem-v2']:[])]}}]})
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}])
   if(path==='/session')return json([session]);if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path==='/terminal/computers')return json({computers:[]})
   if(path==='/provider-keys')return json({ownerSubject:'usr_test',keyStorageAvailable:true,keys:[]})
   if(path==='/provider-keys/catalog')return json({providers:[{id:'openai',name:'OpenAI',models:[{id:'test',name:'Test model'}]}]})
   if(path==='/device/register')return json({});if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Workspace bot/}).click()
  await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Workspace',exact:true}).click()
  const panel=page.getByRole('complementary',{name:'Settings',exact:true}),apply=panel.getByRole('button',{name:'Apply and stop',exact:true})
  await expect(apply).toBeDisabled();await panel.getByRole('button',{name:'Add directory',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Add directory',exact:true})
  await dialog.getByLabel('Directory path',{exact:true}).fill('/Users/calvin/projects');await dialog.getByRole('button',{name:'Add directory',exact:true}).click()
  if(!extended){await expect(dialog.getByRole('alert')).toContainText('workspace-roots worker and runtime update');assert.equal(writes.length,0);return}
  await expect(dialog).toHaveCount(0);await expect(panel.getByRole('list',{name:'Allowed directories'})).toContainText('/Users/calvin/projects')
  await expect(apply).toBeDisabled();assert.equal(writes.length,0)
  await panel.getByRole('button',{name:'Add directory',exact:true}).click();await dialog.getByLabel('Directory path',{exact:true}).fill('/control');await dialog.getByRole('button',{name:'Add directory',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('protected runtime');await page.keyboard.press('Escape')
  await panel.getByRole('checkbox',{name:/Authorize these directories and stop the runtime/}).check();await apply.click()
  await expect.poll(()=>writes.length).toBe(1)
  assert.equal(writes[0].expectedRevision,1);assert.equal(writes[0].action,'configure');assert.equal(writes[0].acknowledgeExecution,true);assert.equal(writes[0].acknowledgeFilesystem,true)
  assert.deepEqual(writes[0].config,{...original,filesystem:{version:1,directories:[{path:'/Users/calvin/projects',access:'read'}]}})
 }finally{await browser.close()}
})
