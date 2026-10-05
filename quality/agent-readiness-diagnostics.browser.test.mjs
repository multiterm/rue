import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
for(const width of [1280,412])test(`readiness and privacy-safe diagnostics at ${width}px`,{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const page=await browser.newPage({viewport:{width,height:915}}),mutations=[]
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedDiagnostics=text}}}))
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`(()=>{let user=null;const listeners=[];const record={subject:'usr_test',userEmail:'test@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'fixture-token':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record}));return {token:'fixture-token',record}},signOut:async()=>{},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
  const session={id:'ses_diagnostics',title:'Fixture bot',ownerSubject:'usr_test',createdAt:1,updatedAt:1,meta:{managedAgentId:'agent'},agent:'pi-terminal',terminalConnectionId:'term_diag',provider:'openai',model:'gpt-4.1-mini',scopes:[],directory:null,parentId:null}
  const host={id:'host',name:'Mason',ownerSubject:'usr_test',status:'online',desired:'active',health:{dockerAvailable:true,acceptingWork:true,capabilities:['managed-agents-v1']}}
  const keys={ownerSubject:'usr_test',keyStorageAvailable:true,keys:[{provider:'openai',configured:false,revision:1,grants:[]}]}
  const agent={id:'agent',workerId:'host',sessionId:session.id,connectionId:session.terminalConnectionId,revision:1,observedRevision:1,desired:'running',observed:'running',config:{provider:'openai',model:'gpt-4.1-mini'},error:'Bearer private-error'}
  await page.route(`${api}/**`,route=>{
   const req=route.request(),path=new URL(req.url()).pathname,json=body=>route.fulfill({json:body}),now=Date.now()
   if(!['GET','OPTIONS'].includes(req.method())&&path!=='/device/register')mutations.push(path)
   if(path==='/trpc/sessionsPage')return json([{result:{data:{json:{items:[session],nextCursor:null}}}}])
   if(path==='/session')return json([session])
   if(path==='/managed-agents')return json({agents:[agent]})
   if(path==='/workers')return json({workers:[host]})
   if(path==='/provider-keys')return json(keys)
   if(path==='/provider-keys/catalog')return json({providers:[{id:'openai',name:'OpenAI',models:[{id:'gpt-4.1-mini',name:'GPT 4.1 mini',contextWindow:100000}]}]})
   if(path==='/terminal/computers')return json({computers:[{id:session.terminalConnectionId,sessionId:session.id,ownerSubject:session.ownerSubject,name:'Private host name',status:'online',remoteEnabled:true,revision:1,serverNow:now,lastSeenAt:now,expiresAt:now+120000,relayProtocol:2,leaseExpiresAt:now+60000,runs:[],health:{transport:'https',agentWorking:false,uploadFailures:0,status:{piVersion:'0.87.1',cwd:'/private/project',branch:'private-branch',state:'idle',provider:'openai',model:'gpt-4.1-mini',thinking:'off',context:{tokens:10,window:100,percent:10},usage:{input:10,output:10,cacheRead:0,cacheWrite:0,costUsd:0},cacheHitPercent:0,subscription:false,autoCompaction:false}}}]})
   if(path.endsWith('/messages')||path.endsWith('/parts')||path==='/sync/preferences')return json([])
   if(path.endsWith('/queue'))return json({messages:[]})
   if(path==='/device/register')return json({})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'})
   return route.fulfill({status:404,json:{error:'not_found'}})
  })
  await page.goto(`${web}/login`);await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name:/Fixture bot/}).click()
  await page.getByLabel('Workspace options').click();await page.locator('.workspace-menu').getByRole('button',{name:'Status',exact:true}).click()
  await page.getByRole('button',{name:'View diagnostics',exact:true}).click()
  const diagnostics=page.getByRole('dialog',{name:'Agent diagnostics',exact:true})
  await diagnostics.getByRole('button',{name:'Copy diagnostics',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.copiedDiagnostics??'')).toContain('0.87.1')
  const text=await page.evaluate(()=>window.copiedDiagnostics);assert.doesNotMatch(text,/private-|\/private|Private host|Fixture bot|Bearer/)
  await diagnostics.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Close settings',exact:true}).click()
  if(width<700)await page.getByRole('button',{name:/Open bot menu/}).click()
  await page.getByRole('button',{name:'Create bot',exact:true}).click()
  const create=page.getByRole('dialog',{name:'Add new bot',exact:true})
  await create.getByLabel('Deployment location',{exact:true}).click();await page.getByRole('option',{name:/Mason/}).click()
  const readiness=create.getByRole('region',{name:'New bot readiness'}),ack=create.getByRole('checkbox',{name:'Authorize managed bot execution'})
  await expect(readiness).toContainText('Configure this provider');await expect(ack).toBeDisabled()
  keys.keys[0].configured=true;await readiness.getByRole('button',{name:'Recheck setup'}).click();await expect(ack).toBeEnabled();await expect(readiness).toContainText('Required after creation')
  await ack.check();keys.keyStorageAvailable=false;await readiness.getByRole('button',{name:'Recheck setup'}).click();await expect(ack).toBeDisabled();await expect(ack).not.toBeChecked()
  assert.deepEqual(mutations,[])
 }finally{await browser.close()}
})
