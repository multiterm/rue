import {test,expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
const apiOrigin='https://api.rue.test',token='tnk_'+'s'.repeat(43)
function loginUrl(callback='http://127.0.0.1:43210/callback'){
 return '/cli-login#'+new URLSearchParams({apiOrigin,callback,state:'a'.repeat(43),requestId:randomUUID(),expiresAt:String(Date.now()+300000)})
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{(globalThis as any).__RUE_PUBLIC_CONFIG__={VITE_RUE_API_URL:'https://api.rue.test'}})
 await page.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'text/javascript',body:`(()=>{let user=null,listeners=[];const record={subject:'usr_cli',userEmail:'cli@example.test',principalType:'user'};window.Keyname={ready:Promise.resolve(),currentUser:async()=>user,getAccessToken:async()=>user?'synthetic-human-session':null,signIn:async()=>{user=record;listeners.forEach(fn=>fn({authenticated:true,record:user}));return {token:'synthetic-human-session',record}},signOut:async()=>{},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}})()`}))
})
test('CLI browser approval is explicit, scoped and delivers secrets only in the loopback POST',async({page})=>{
 const issued:any[]=[],delivered:any[]=[]
 await page.route(apiOrigin+'/api-keys',route=>{
  const input=route.request().postDataJSON();issued.push(input)
  expect(route.request().headers().authorization).toBe('Bearer synthetic-human-session')
  return route.fulfill({status:201,json:{...input,id:'key_cli',owner:{type:'self',subject:'usr_cli'},service:'rue',createdAt:Date.now(),revokedAt:null,token}})
 })
 await page.route('http://127.0.0.1:43210/callback',route=>{delivered.push(route.request().postDataJSON());return route.fulfill({status:204,headers:{'access-control-allow-origin':'http://127.0.0.1:5173'}})})
 await page.goto(loginUrl());await expect(page.getByText('aaaaaaaa',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Approve CLI login'})).toHaveCount(0);expect(issued).toHaveLength(0)
 await page.getByRole('button',{name:'Sign in with Keyname'}).click();await expect(page.getByText('Signed in as cli@example.test')).toBeVisible();expect(issued).toHaveLength(0)
 await page.getByRole('button',{name:'Approve CLI login'}).click();await expect(page.getByRole('status')).toContainText('Approved')
 expect(issued).toHaveLength(1);expect(issued[0].grants).toEqual(['rue:hosts:read','rue:agents:read','rue:agents:write','rue:agents:execute']);expect(issued[0].owner).toEqual({type:'self'})
 expect(issued[0].expiresAt-Date.now()).toBeLessThanOrEqual(3600000);expect(issued[0].expiresAt-Date.now()).toBeGreaterThan(3500000)
 expect(delivered).toEqual([{state:'a'.repeat(43),token,subject:'usr_cli',keyId:'key_cli'}])
 expect(page.url()).not.toContain(token);expect(await page.locator('body').textContent()).not.toContain(token)
 expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(token)
})
test('CLI approval rejects non-loopback destinations without issuing keys',async({page})=>{
 let issued=0;await page.route(apiOrigin+'/**',route=>{issued++;return route.fulfill({status:500})})
 await page.goto(loginUrl('https://attacker.test/callback'));await expect(page.getByRole('alert')).toContainText('invalid or expired');await expect(page.getByRole('button',{name:'Approve CLI login'})).toHaveCount(0);expect(issued).toBe(0)
})
test('CLI approval cannot be embedded in a frame',async({page})=>{
 await page.goto('/cli-login')
 await page.evaluate(url=>{const frame=document.createElement('iframe');frame.src=url;document.body.replaceChildren(frame)},loginUrl())
 await expect(page.frameLocator('iframe').getByRole('alert')).toContainText('invalid or expired')
 await expect(page.frameLocator('iframe').getByRole('button',{name:'Approve CLI login'})).toHaveCount(0)
})
test('failed delivery revokes the issued key and never automatically retries issuance',async({page})=>{
 let issued=0,revoked=0
 await page.route(apiOrigin+'/api-keys',route=>{issued++;return route.fulfill({status:201,json:{...route.request().postDataJSON(),id:'key_cli',owner:{type:'self',subject:'usr_cli'},service:'rue',createdAt:Date.now(),revokedAt:null,token}})})
 await page.route(apiOrigin+'/api-keys/key_cli',route=>{expect(route.request().method()).toBe('DELETE');revoked++;return route.fulfill({status:204})})
 await page.route('http://127.0.0.1:43210/callback',route=>route.abort())
 await page.goto(loginUrl());await page.getByRole('button',{name:'Sign in with Keyname'}).click();await page.getByRole('button',{name:'Approve CLI login'}).click()
 await expect(page.getByRole('alert')).toContainText('not confirmed');await expect(page.getByRole('button',{name:'Approve CLI login'})).toBeDisabled();expect(issued).toBe(1);expect(revoked).toBe(1)
})
