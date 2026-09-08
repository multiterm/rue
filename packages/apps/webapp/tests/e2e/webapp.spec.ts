import {expect,test} from '@playwright/test'
const tokenRecord={token:'keyname-test-token',record:{subject:'usr_test',userEmail:'rue@example.com',principalType:'user'}}
test.beforeEach(async({page})=>{
  const sessions:Array<Record<string,unknown>>=[];const messages=new Map<string,Array<Record<string,unknown>>>();const parts=new Map<string,Array<Record<string,unknown>>>();const devices:Array<Record<string,unknown>>=[]
  await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:`(()=>{let user=null;let listeners=[];window.Keyname={ready:Promise.resolve(null),currentUser:async()=>user,getAccessToken:async()=>user?'keyname-test-token':null,signIn:async({mode})=>{window.__keynameMode=mode;if(mode==='modal'){user=${JSON.stringify(tokenRecord.record)};listeners.forEach(fn=>fn({authenticated:true,record:user}));return ${JSON.stringify(tokenRecord)}}return null},signOut:async()=>{user=null;listeners.forEach(fn=>fn({authenticated:false,record:null}))},closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>listeners=listeners.filter(x=>x!==fn)},startSessionPolling(){return 0}}})()`}))
  await page.route('http://localhost:4097/**',async route=>{const request=route.request();const url=new URL(request.url());const path=url.pathname;const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});if(path.startsWith('/trpc/auth.login'))return json({result:{data:{json:{accessToken:'keyname-credential-token',subject:'usr_test',userEmail:'rue@example.com'}}}});if(path.startsWith('/trpc/auth.verifyMfa'))return json({result:{data:{json:{accessToken:'keyname-credential-token',subject:'usr_test',userEmail:'rue@example.com'}}}});if(path==='/device/register'){const input=request.postDataJSON();const row={id:input.deviceId,ownerSubject:'usr_test',name:input.name,platform:input.platform,createdAt:1,lastSeenAt:2,revokedAt:null};if(!devices.some(item=>item.id===row.id))devices.push(row);return json(row)}if(path==='/device'&&request.method()==='GET')return json(devices);if(path==='/pairing'&&request.method()==='POST')return json({id:'pair_1',token:'pair-secret',code:'12345678',expiresAt:Date.now()+300000});if(path==='/pairing/redeem'&&request.method()==='POST')return json({device:{},pairingId:'pair_1',synced:true});if(path==='/pairing/pair_1')return json({id:'pair_1',expiresAt:Date.now()+300000,claimedAt:null,claimedDeviceId:null});if(path==='/session'&&request.method()==='GET')return json(sessions);if(path==='/session'&&request.method()==='POST'){const input=request.postDataJSON();const id=`ses_${sessions.length+1}`;const session={id,title:input.title??'',agent:null,provider:'openrouter',model:'test',directory:null,scopes:[],parentId:null,ownerSubject:'usr_test',createdAt:Date.now(),updatedAt:Date.now(),meta:input.meta??{}};sessions.unshift(session);messages.set(id,[]);parts.set(id,[]);return json(session)}const sessionMatch=path.match(/^\/session\/([^/]+)$/);if(sessionMatch&&request.method()==='DELETE'){const index=sessions.findIndex(item=>item.id===sessionMatch[1]);if(index>=0)sessions.splice(index,1);messages.delete(sessionMatch[1]);parts.delete(sessionMatch[1]);return json({deleted:index>=0})}const messageMatch=path.match(/^\/session\/([^/]+)\/message$/);if(messageMatch&&request.method()==='POST'){const id=messageMatch[1];const input=request.postDataJSON();const userId='msg_user',assistantId='msg_assistant';messages.set(id,[{id:userId,sessionId:id,role:'user',time:Date.now(),provider:null,model:null,agent:null,meta:{},seq:0},{id:assistantId,sessionId:id,role:'assistant',time:Date.now(),provider:'openrouter',model:'test',agent:null,meta:{},seq:1}]);parts.set(id,[{id:'txt_user',sessionId:id,messageId:userId,type:'text',seq:0,payload:{text:input.text}},{id:'txt_assistant',sessionId:id,messageId:assistantId,type:'text',seq:0,payload:{text:'Hello from Rue'}}]);return json({userMessageId:userId,assistantMessageId:assistantId,text:'Hello from Rue',stopReason:'completed'})}const messagesMatch=path.match(/^\/session\/([^/]+)\/messages$/);if(messagesMatch)return json(messages.get(messagesMatch[1])??[]);const partsMatch=path.match(/^\/session\/([^/]+)\/parts$/);if(partsMatch)return json(parts.get(partsMatch[1])??[]);return json({error:'not_found'},404)})
})
test('portal-style login uses shared inputs and Zod validation',async({page})=>{await page.goto('/login');await expect(page.getByRole('heading',{name:'Login to your account'})).toBeVisible();await page.getByLabel('Email Address / Username').fill('x');await page.getByRole('textbox',{name:'Password'}).fill('short');await expect(page.getByRole('button',{name:'Login'})).toBeDisabled();await expect(page).toHaveScreenshot('rue-portal-login.png',{animations:'disabled',fullPage:true})})
test('credential login completes through the typed tRPC mutation',async({page})=>{await page.goto('/login');await page.getByLabel('Email Address / Username').fill('rue@example.com');await page.getByRole('textbox',{name:'Password'}).fill('correct-horse-battery');await page.getByRole('button',{name:'Login'}).click();await expect(page).toHaveURL('http://127.0.0.1:5173/');await expect(page.getByText('rue@example.com')).toBeVisible()})
test('anonymous users receive the Keyname login page',async({page})=>{await page.goto('/');await expect(page).toHaveURL(/\/login\?redirect=%2F/);await expect(page.getByRole('heading',{name:'Login to your account'})).toBeVisible();await expect(page.getByRole('button',{name:/Sign in with Keyname/})).toBeEnabled()})
test('Keyname modal signs in and sign-out returns to login',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await expect(page).toHaveURL('http://127.0.0.1:5173/');await expect(page.getByText('rue@example.com')).toBeVisible();await expect(page.getByText('Your Rue crew starts here.')).toBeVisible();await page.getByRole('button',{name:'Sign out'}).click();await expect(page).toHaveURL(/\/login/)})
test('workspace creates a session and completes a message round trip',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Chief of Staff');await page.getByLabel('Description').fill('Plans the day and keeps work moving.');await page.getByRole('button',{name:'Add bot'}).click();const message=page.getByRole('textbox',{name:'Message',exact:true});await message.fill('Hello Rue');await page.getByRole('button',{name:'Send message'}).click();await expect(message).toHaveValue('');await expect(page.getByText('Done.')).toBeVisible();await expect(page.getByText('Hello from Rue')).toBeVisible()})
test('redirect login mode is available',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:'Create an account'}).click();await expect.poll(()=>page.evaluate(()=>window.__keynameMode)).toBe('redirect')})
test('creates a QR, link, and fallback code for another device',async({page})=>{await page.goto('/login');await page.getByRole('button',{name:/Sign in with Keyname/}).click();await page.getByRole('button',{name:'Create first bot'}).click();await page.getByLabel('Bot name').fill('Chief of Staff');await page.getByLabel('Description').fill('Plans the day and keeps work moving.');await page.getByRole('button',{name:'Add bot'}).click();await page.getByLabel('Workspace options').click();await page.getByRole('button',{name:'Link device'}).click();await page.getByRole('button',{name:'Create secure pairing'}).click();await expect(page.getByAltText('Scan to link this Rue account')).toBeVisible();await expect(page.getByText('1234 5678')).toBeVisible();await expect(page.getByLabel('Pairing link')).toHaveValue('rue://link?token=pair-secret')})
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
    if (name === 'First bot' && test.info().project.name === 'mobile') await page.getByRole('button', { name: '‹ Bots' }).click()
  }
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: '‹ Bots' }).click()
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
  await expect(page.getByRole('alert')).toContainText('Your draft has been kept')
  await expect(composer).toHaveValue('Keep my message')
  await expect(page.getByRole('heading', { name: 'Chat with Retry bot' })).toBeVisible()
})
test('agent settings save account defaults and never refill or locally persist the API key', async ({ page }) => {
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
  await page.locator('summary:visible').click()
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click()
  await expect(page.locator('.bot-profile').getByRole('button', { name: 'Agent settings' })).toHaveCount(0)
  const dialog = page.getByRole('dialog', { name: 'Agent settings' })
  for (const name of ['Agent harness', 'Model provider', 'Model', 'System prompt', 'OpenAI API key']) {
    const label = await dialog.locator('label').filter({ hasText: new RegExp(`^${name}$`) }).boundingBox()
    const control = await dialog.getByLabel(name, { exact: true }).boundingBox()
    expect(label && control && label.y + label.height <= control.y).toBe(true)
  }
  await page.getByRole('combobox', { name: 'Model', exact: true }).click()
  await page.getByRole('option', { name: 'gpt-5-mini', exact: true }).click()
  await page.getByLabel('System prompt').fill('Help me plan my day.')
  await expect(page.getByLabel('OpenAI API key', { exact: true })).toHaveAttribute('type', 'password')
  await page.getByLabel('OpenAI API key', { exact: true }).fill('test-provider-key')
  await page.getByRole('button', { name: 'Save agent settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Agent settings' })).toHaveCount(0)
  expect(submitted[0]).toMatchObject({ harness: 'pi', provider: 'openai', model: 'gpt-5-mini', systemPrompt: 'Help me plan my day.', apiKey: 'test-provider-key', expectedOwnerSubject: 'usr_test' })
  await page.locator('summary:visible').click()
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click()
  await expect(page.getByLabel('OpenAI API key', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('System prompt')).toHaveValue('Help me plan my day.')
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('test-provider-key')
  await page.getByRole('button', { name: 'Save agent settings' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(submitted[1]).not.toHaveProperty('apiKey')
  await page.locator('summary:visible').click()
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click()
  await page.getByLabel('Remove saved API key').check()
  await page.getByRole('button', { name: 'Save agent settings' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(submitted[2]?.apiKey).toBeNull()
})
declare global{interface Window{__keynameMode?:string}}
