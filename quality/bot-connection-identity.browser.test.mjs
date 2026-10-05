import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])test(`connection details distinguish managed host from agent at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport:{width,height:915}}),agentId=randomUUID(),workerId=randomUUID(),connectionId='term_'+'a'.repeat(32)
  let managed=true,hostName='Mason',missingHost=false
  const session=()=>({id:'ses_identity',title:'Honeycluster',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:managed?{managedAgentId:agentId}:{},agent:'pi-terminal',terminalConnectionId:connectionId,provider:'openai',model:'test',scopes:[],directory:null,parentId:null})
  const agent={id:agentId,workerId,sessionId:'ses_identity',connectionId,name:'Honeycluster',desired:'running',observed:'running',revision:1,observedRevision:1,config:{provider:'openai',model:'test',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}}
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  await page.route(`${api}/**`,route=>{
   const path=new URL(route.request().url()).pathname,json=body=>route.fulfill({json:body}),now=Date.now()
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session()],nextCursor:null}}}}])
   if(path==='/session')return json([session()])
   if(path==='/managed-agents')return json({agents:[{...agent,id:randomUUID(),name:'Other agent'},agent]})
   if(path==='/workers')return json({workers:[{id:workerId,ownerSubject:'other-owner',name:'Wrong owner host'},...(!missingHost?[{id:workerId,ownerSubject:'usr_test',name:hostName,status:'online',desired:'active',serverNow:now,leaseExpiresAt:now+60000,health:{capabilities:['managed-agents-v1']}}]:[])]})
   if(path==='/terminal/computers')return json({computers:[{id:connectionId,sessionId:'ses_identity',ownerSubject:'usr_test',name:managed?'Honeycluster':'Linked laptop',status:'online',remoteEnabled:true,revision:1,serverNow:now,lastSeenAt:now,expiresAt:now+300000,relayProtocol:2,leaseExpiresAt:now+60000,runs:[],health:{transport:'websocket',pendingCount:0,agentWorking:false,uploadFailures:0}}]})
   if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path.endsWith('/operations'))return json({operations:[]})
   if(path.endsWith('/compactions'))return json({commands:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  const open=async()=>{await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Honeycluster/}).click();await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Connection',exact:true}).click()}
  await open()
  const panel=page.getByRole('region',{name:'Connection info',exact:true}),value=label=>panel.locator('.bot-settings-facts > div').filter({has:page.locator('dt').filter({hasText:new RegExp(`^${label}$`)})}).locator('dd')
  await expect(value('Host')).toHaveText('Mason');await expect(value('Agent')).toHaveText('Honeycluster');await expect(value('Computer')).toHaveCount(0)
  hostName='Mason renamed';await panel.getByRole('button',{name:'Refresh connection',exact:true}).click();await expect(value('Host')).toHaveText('Mason renamed')
  missingHost=true;await expect(panel.getByRole('button',{name:'Refresh connection',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'Refresh connection',exact:true}).click();await expect(value('Host')).toHaveText('Not reported');await expect(value('Agent')).toHaveText('Honeycluster')
  managed=false;await open();await expect(value('Computer')).toHaveText('Linked laptop');await expect(value('Host')).toHaveCount(0);await expect(value('Agent')).toHaveCount(0)
 }finally{await browser.close()}
})
