import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const viewport of [{width:1280,height:900},{width:412,height:915}])test(`chat explains missing Codex access before sending at ${viewport.width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport}),mutations=[]
  const connectionId='term_'+'a'.repeat(32),agentId='898cdf78-e204-4760-80f6-c219286d6564'
  const session={id:'ses_access',title:'Honeycluster',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{managedAgentId:agentId},agent:'pi-terminal',terminalConnectionId:connectionId,provider:'openai-codex',model:'test',scopes:[],directory:null,parentId:null}
  const cloud={...session,id:'ses_cloud',title:'Cloud bot',meta:{},agent:'default',terminalConnectionId:null}
  const agent={id:agentId,workerId:'host',sessionId:session.id,connectionId,name:session.title,desired:'running',observed:'running',revision:1,config:{provider:'openai-codex',model:'test'}}
  const oauth={ownerSubject:'usr_test',provider:'openai-codex',credentialType:'oauth',configured:true,keyStorageAvailable:true,runtimeSupported:true,state:'ready',revision:7,grants:[]}
  let fail=false,reads=0,disconnected=false
  agent.connectionId=null
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  await page.route(`${api}/**`,route=>{
   const request=route.request(),path=new URL(request.url()).pathname,json=(body,status=200)=>route.fulfill({json:body,status})
   if(!['GET','OPTIONS'].includes(request.method())&&path!=='/device/register')mutations.push(path)
   if(path==='/managed-agents')return json({agents:[agent]})
   if(path==='/provider-keys'){reads++;return fail?json({error:'unavailable'},503):json({ownerSubject:'usr_test',keyStorageAvailable:true,keys:[{provider:'openai',configured:true,revision:1,grants:[{type:'terminal',id:connectionId}]}],oauth})}
   if(path==='/provider-oauth/openai-codex')return json(oauth)
   if(path==='/provider-keys/catalog')return json({providers:[]})
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session,cloud],nextCursor:null}}}}])
   if(path==='/session')return json([session,cloud])
   if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path==='/terminal/computers'){const now=Date.now();return json({computers:[{id:connectionId,ownerSubject:'usr_test',sessionId:session.id,name:'Honeycluster',status:disconnected?'offline':'online',remoteEnabled:true,serverNow:now,lastSeenAt:now,expiresAt:now+120000,relayProtocol:2,leaseExpiresAt:now+60000,runs:[],health:{agentWorking:false,uploadFailures:0}}]})}
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return json({error:'not_found'},404)
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  const bots=page.getByRole('navigation',{name:'Sessions',exact:true})
  await bots.getByRole('button',{name:/Honeycluster/}).click()
  const notice=page.getByRole('status',{name:'Bot setup needs attention'}),draft=page.getByRole('textbox',{name:'Message',exact:true})
  await expect.poll(()=>reads).toBeGreaterThan(0);await page.waitForTimeout(500);await expect(notice).toHaveCount(0)
  agent.connectionId=connectionId
  await expect(notice).toBeVisible({timeout:12000});await expect(notice).toContainText('missing a configured credential or its explicit access grant')
  await expect(page.locator('.message-column .message-row.system').filter({has:page.getByText('Bot setup needs attention',{exact:true})})).toHaveCount(1)
  await expect(notice.locator('.message-with-actions > .message-bubble > .message-header')).toBeVisible()
  assert.ok(await notice.locator('.message-bubble').evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius)>0),'Notice uses rounded chat bubble styling')
  await draft.fill('Keep this draft; do not send it')
  await notice.getByRole('button',{name:'Grant this bot credential access',exact:true}).click()
  const help=page.getByRole('dialog',{name:'Grant this bot credential access',exact:true})
  await expect(help).toContainText('Manage access');await expect(help).toContainText('Reconnecting OAuth clears previous bot grants')
  await help.getByRole('button',{name:'Open AI keys',exact:true}).click()
  await expect(page.getByRole('tab',{name:'AI keys',exact:true})).toHaveAttribute('aria-selected','true')
  await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:'Close dialog',exact:true}).click()
  await expect(draft).toHaveValue('Keep this draft; do not send it')
  oauth.grants=[{type:'terminal',id:connectionId}]
  await notice.getByRole('button',{name:'Check again',exact:true}).click();await expect(notice).toHaveCount(0)
  disconnected=true;await expect(notice).toBeVisible({timeout:12000})
  await notice.getByRole('button',{name:'Reconnect the agent',exact:true}).click()
  const reconnect=page.getByRole('dialog',{name:'Reconnect the agent',exact:true});await expect(reconnect).toContainText('does not safely replay work')
  await reconnect.getByRole('button',{name:'Done',exact:true}).click()
  disconnected=false;await notice.getByRole('button',{name:'Check again',exact:true}).click();await expect(notice).toHaveCount(0)
  await expect(draft).toHaveValue('Keep this draft; do not send it');assert.deepEqual(mutations,[])
  // Reconnecting clears grants. Polling must expose that change even without SSE.
  oauth.grants=[];await expect(notice).toBeVisible({timeout:12000})
  fail=true;await notice.getByRole('button',{name:'Check again',exact:true}).click();await expect(notice).toContainText('check failed or timed out')
  await notice.getByRole('button',{name:'Troubleshoot status checks',exact:true}).click()
  const checks=page.getByRole('dialog',{name:'Troubleshoot status checks',exact:true});await expect(checks).toContainText('does not prove that the agent stopped');await checks.getByRole('button',{name:'Done',exact:true}).click()
  fail=false;await notice.getByRole('button',{name:'Check again',exact:true}).click();await expect(notice).toContainText('missing a configured credential or its explicit access grant')
  if(viewport.width<700)await page.getByRole('button',{name:/menu/i}).first().click()
  await bots.getByRole('button',{name:/Cloud bot/}).click();await expect(notice).toHaveCount(0)
  const before=reads;await page.waitForTimeout(5500);assert.ok(reads<=before+1,'Only the shared sidebar metadata refresh may run; unmanaged chat must not poll managed preflight');assert.deepEqual(mutations,[])
 }finally{await browser.close()}
})
