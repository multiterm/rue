import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const viewport of [{width:1280,height:900},{width:412,height:915}])test(`conversation search lives in the menu, focuses results and isolates bot queries at ${viewport.width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const context=await browser.newContext({viewport}),page=await context.newPage()
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session=id=>({id,title:id==='ses_search'?'Search bot':'Other bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{},agent:null,provider:null,model:null,scopes:[],directory:null,parentId:null})
  const sessions=[session('ses_search'),session('ses_other')],time=Date.now()-600000
  const messages=Array.from({length:50},(_,i)=>({id:`msg${i}`,sessionId:'ses_search',role:i%2?'assistant':'user',time:time+i,seq:i,meta:{},provider:null,model:null,agent:null}))
  const parts=messages.map((message,i)=>({id:`part${i}`,sessionId:message.sessionId,messageId:message.id,type:'text',seq:0,payload:{text:i===5?'Target navigation-needle for search.':`Message ${i}. `+'Example conversation text. '.repeat(12)}}))
  const group=randomUUID()
  for(const [index,id,text] of [[0,'group_first','Grouped output: '],[1,'group_second','group-only-needle']]){messages.push({id,sessionId:'ses_search',role:'assistant',time:time+50+index,seq:50+index,meta:{origin:'computer'},provider:null,model:null,agent:null});parts.push({id:`part_${id}`,sessionId:'ses_search',messageId:id,type:'text',seq:0,payload:{text,tool:{id:group,chunk:index}}})}
  await page.route(`${api}/**`,route=>{const path=new URL(route.request().url()).pathname,json=body=>route.fulfill({json:body});if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:sessions,nextCursor:null}}}}]);if(path==='/session')return json(sessions);if(path==='/session/ses_search/messages')return json(messages);if(path==='/session/ses_search/parts')return json(parts);if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([]);if(path==='/terminal/computers')return json({computers:[]});if(path==='/workers')return json({workers:[]});if(path==='/device/register')return json({});if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});return route.fulfill({status:404,json:{error:'not_found'}})})
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Search bot/}).click()
  const log=page.getByRole('log',{name:'Conversation'});await expect(log.locator('input[type="search"]')).toHaveCount(0);await expect(log.getByText('Search',{exact:true})).toHaveCount(0)
  async function openSearch(){await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Search',exact:true}).click()}
  await openSearch();const dialog=page.getByRole('dialog',{name:'Search',exact:true}),input=dialog.getByLabel('Search loaded history',{exact:true})
  await expect(input).toBeFocused();await input.fill('navigation-needle');await expect(dialog.getByRole('status')).toHaveText('1 match')
  await dialog.getByRole('button',{name:/navigation-needle/}).click();await expect(dialog).toHaveCount(0)
  await expect(page.locator('#message-msg5 .message-bubble')).toBeFocused()
  await expect.poll(()=>page.locator('#message-msg5').evaluate(el=>{const box=el.getBoundingClientRect(),viewport=document.querySelector('.chat-scroll-viewport').getBoundingClientRect();return box.bottom>viewport.top&&box.top<viewport.bottom})).toBe(true)
  await openSearch();await expect(input).toHaveValue('navigation-needle');await input.fill('group-only-needle');await dialog.getByRole('button',{name:/group-only-needle/}).click();await expect(dialog).toHaveCount(0)
  await expect(page.locator('#message-group_second')).toHaveCount(0);await expect(page.locator('#message-group_first .message-bubble')).toBeFocused()
  await openSearch();await expect(input).toHaveValue('group-only-needle');await input.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByLabel('Workspace options')).toBeFocused()
  if(viewport.width<700)await page.getByRole('button',{name:'Open bot menu',exact:true}).click()
  await page.getByRole('navigation',{name:'Sessions'}).getByRole('button',{name:/Other bot/}).click();await openSearch();await expect(input).toHaveValue('');await input.fill('navigation-needle');await expect(dialog.getByRole('status')).toHaveText('0 matches')
  assert.equal(await log.locator('input[type="search"]').count(),0)
 }finally{await browser.close()}
})
