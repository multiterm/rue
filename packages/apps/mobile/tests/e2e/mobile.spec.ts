import {expect,test} from '@playwright/test'
test('mobile application matches the approved bot onboarding layout',async({page})=>{await page.goto('/');await expect(page.getByText('RUE',{exact:true})).toBeVisible();await expect(page.getByText('Meet Your First Bot')).toBeVisible();await expect(page.getByText('Chief of Staff')).toBeVisible();await expect(page.getByText('Start Chat')).toBeVisible();await expect(page).toHaveScreenshot('rue-mobile-bot-onboarding.png',{animations:'disabled',fullPage:true})})
test('authenticated mobile bot list and conversation match the references',async({page})=>{const sessions=['Dex','Miles','Reed','Kai','Ace','Max','Kara'].map((title,index)=>({id:`ses_${index}`,title,agent:null,provider:'test',model:'test',directory:null,scopes:[],parentId:null,ownerSubject:'usr_test',createdAt:1,updatedAt:2,meta:{}}));await page.addInitScript(()=>{localStorage.setItem('rue.keyname.tokens',JSON.stringify({accessToken:'mobile-token'}));localStorage.setItem('rue.device.id','dev_mobile')});await page.route('https://api.rue.multiterm.dev/**',route=>{const request=route.request(),path=new URL(request.url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});if(path==='/session')return json(sessions);if(path==='/device/register')return json({id:'dev_mobile',name:'Rue Mobile',platform:'android',ownerSubject:'usr_test',createdAt:1,lastSeenAt:2,revokedAt:null});if(path==='/device')return json([]);if(path.endsWith('/messages'))return json([{id:'msg_1',sessionId:'ses_0',role:'assistant',time:1,provider:'test',model:'test',agent:null,meta:{},seq:0}]);if(path.endsWith('/parts'))return json([{id:'part_1',sessionId:'ses_0',messageId:'msg_1',type:'text',seq:0,payload:{text:'Your briefing is ready.'}}]);return json({})});await page.goto('/');await expect(page.getByText('Dex')).toBeVisible();await expect(page).toHaveScreenshot('rue-mobile-bot-list.png',{animations:'disabled',fullPage:true});await page.getByText('Dex').click();await expect(page.getByText('Your briefing is ready.')).toBeVisible();await expect(page).toHaveScreenshot('rue-mobile-bot-chat.png',{animations:'disabled',fullPage:true})})

test('remote prompts retain the draft and idempotency ID after a lost response', async ({ page }) => {
  const requests: any[] = []
  await page.addInitScript(() => { localStorage.setItem('rue.keyname.tokens', JSON.stringify({ accessToken: 'mobile-token' })); localStorage.setItem('rue.device.id', 'dev_mobile') })
  await page.route('https://api.rue.multiterm.dev/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/session') return route.fulfill({ json: [{ id:'ses_remote',title:'Remote bot',agent:'pi-terminal',terminalConnectionId:'term_one',ownerSubject:'usr_test',meta:{},createdAt:1,updatedAt:1 }] })
    if (path.endsWith('/message')) { requests.push(route.request().postDataJSON()); if(requests.length===1)return route.abort('failed');return route.fulfill({ json: {userMessageId:'u',assistantMessageId:'a',stopReason:'queued'} }) }
    return route.fulfill({ json: path==='/device/register'?{}:[] })
  })
  await page.goto('/'); await page.getByText('Remote bot',{exact:true}).click()
  const draft=page.getByRole('textbox',{name:'Message',exact:true})
  const send = page.getByRole('button', { name: 'Send message' })
  await expect(send).toBeDisabled()
  await expect(send).toHaveCSS('cursor', 'not-allowed')
  await draft.fill('Hello remote')
  await expect(send).toBeEnabled()
  await expect(send).toHaveCSS('cursor', 'pointer')
  await send.focus()
  await expect(send).toHaveCSS('outline-width', '2px')
  await send.click()
  await expect(page.getByText(/Message failed. Your draft has been kept/)).toBeVisible()
  await expect(draft).toHaveValue('Hello remote')
  await page.getByRole('button',{name:'Send message'}).click()
  await expect(draft).toHaveValue('')
  expect(requests).toHaveLength(2);expect(requests[0].requestId).toMatch(/^[a-f0-9-]{36}$/);expect(requests[1].requestId).toBe(requests[0].requestId)
})

test('a delayed conversation snapshot cannot replace the newly selected bot', async ({ page }) => {
  const sessions = ['Dex', 'Miles'].map((title, index) => ({ id: `ses_${index}`, title, agent: null, provider: 'test', model: 'test', directory: null, scopes: [], parentId: null, ownerSubject: 'usr_test', createdAt: 1, updatedAt: 2, meta: {} }))
  await page.addInitScript(() => {
    localStorage.setItem('rue.keyname.tokens', JSON.stringify({ accessToken: 'mobile-token' }))
    localStorage.setItem('rue.device.id', 'dev_mobile')
  })
  let release!: () => void
  let seen!: () => void
  const delayed = new Promise<void>((resolve) => { release = resolve })
  const requested = new Promise<void>((resolve) => { seen = resolve })
  await page.route('https://api.rue.multiterm.dev/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    if (path === '/session') return json(sessions)
    if (path === '/device') return json([])
    const sessionId = path.split('/')[2]
    if (path.endsWith('/messages')) return json([{ id: `msg_${sessionId}`, sessionId, role: 'assistant', time: 1, provider: 'test', model: 'test', agent: null, meta: {}, seq: 0 }])
    if (path.endsWith('/parts')) {
      if (sessionId === 'ses_0') { seen(); await delayed }
      return json([{ id: `part_${sessionId}`, sessionId, messageId: `msg_${sessionId}`, type: 'text', seq: 0, payload: { text: sessionId === 'ses_0' ? 'Stale Dex snapshot' : 'Current Miles snapshot' } }])
    }
    return json({})
  })
  await page.goto('/')
  await page.getByText('Dex', { exact: true }).click()
  await requested
  await page.getByText('‹ Bots', { exact: true }).click()
  await page.getByText('Miles', { exact: true }).click()
  await expect(page.getByText('Current Miles snapshot')).toBeVisible()
  const oldResponse = page.waitForResponse((response) => response.url().endsWith('/session/ses_0/parts'))
  release()
  await (await oldResponse).finished()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page.getByText('Current Miles snapshot')).toBeVisible({ timeout: 100 })
  await expect(page.getByText('Stale Dex snapshot')).toHaveCount(0)
})
