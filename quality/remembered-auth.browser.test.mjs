import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const web=process.env.RUE_TEST_WEB_URL,api=process.env.RUE_TEST_API_URL
const sdk=`(()=>{
 const key='keyname.auth.tokens.v1',listeners=[];
 let tokens=JSON.parse(sessionStorage.getItem(key)||'null');
 function save(value){tokens=value;sessionStorage.setItem(key,JSON.stringify(value));listeners.forEach(fn=>fn({authenticated:true,record:value.record}));return value}
 function clear(){tokens=null;sessionStorage.removeItem(key);listeners.forEach(fn=>fn({authenticated:false,record:null,reason:'revoked'}))}
 const record={subject:'usr_remembered',userEmail:'remembered@example.test',principalType:'user',expiresAt:Date.now()+3600000};
 window.Keyname={ready:Promise.resolve(tokens),currentUser:async()=>tokens?.record||null,
 getAccessToken:async()=>{if(tokens&&tokens.record.expiresAt<Date.now()){const r=await fetch('https://api.keyname.dev/v1/auth/refresh',{method:'POST'});if(!r.ok){clear();throw Error('revoked')}save(await r.json())}return tokens?.token||null},
 session:async()=>{if(!tokens)return {authenticated:false};const r=await fetch('https://api.keyname.dev/v1/auth/session');if(r.status===401){clear();return {authenticated:false}}if(!r.ok)throw Error('offline');return {authenticated:true,session:tokens.record}},
 signIn:async()=>save({token:'fixture-access',refreshToken:'fixture-refresh',record}),signOut:async()=>clear(),closeModal(){},onAuthChange(fn){listeners.push(fn);return()=>{}},startSessionPolling(){return 0}}
})()`
test('mobile cold start restores and refreshes sessions; network failure preserves them; revocation clears them',{skip:!web||!api},async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined})
 try{
  const context=await browser.newContext({viewport:{width:412,height:915}})
  let revoked=false,offline=false,refreshes=0
  await context.route('https://api.keyname.dev/auth.js',route=>route.fulfill({contentType:'application/javascript',body:sdk}))
  await context.route('https://api.keyname.dev/v1/auth/session',route=>route.fulfill({status:revoked?401:offline?503:200,json:{}}))
  await context.route('https://api.keyname.dev/v1/auth/refresh',route=>{refreshes++;return route.fulfill({json:{token:'fixture-refreshed',refreshToken:'fixture-refresh',record:{subject:'usr_remembered',userEmail:'remembered@example.test',principalType:'user',expiresAt:Date.now()+3600000}}})})
  await context.route(`${api}/**`,route=>{
   const path=new URL(route.request().url()).pathname
   if(path==='/trpc/sessionsPage')return route.fulfill({json:[{result:{data:{json:{items:[],nextCursor:null}}}}]})
   if(path==='/event')return route.fulfill({contentType:'text/event-stream',body:': test\n\n'})
   return route.fulfill({json:path==='/device/register'?{}:[]})
  })
  let page=await context.newPage();await page.goto(`${web}/login`)
  await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await expect(page.getByRole('navigation',{name:'Sessions',exact:true})).toBeVisible()
  const key='rue.auth.remembered.v1:https://api.keyname.dev'
  await expect.poll(()=>page.evaluate(k=>Boolean(localStorage.getItem(k)),key)).toBe(true)
  await page.evaluate(k=>{const saved=JSON.parse(localStorage.getItem(k));saved.tokens.record.expiresAt=1;localStorage.setItem(k,JSON.stringify(saved))},key)
  await page.close();page=await context.newPage();await page.goto(`${web}/login`)
  await expect(page.getByRole('navigation',{name:'Sessions',exact:true})).toBeVisible()
  assert.equal(refreshes,1)
  await page.close();offline=true;page=await context.newPage();await page.goto(`${web}/login`)
  await expect(page.getByText('Could not verify your saved session. Check your connection and try again.')).toBeVisible()
  assert.ok(await page.evaluate(k=>localStorage.getItem(k),key))
  offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  await expect(page.getByRole('navigation',{name:'Sessions',exact:true})).toBeVisible()
  revoked=true;await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')))
  await expect(page.getByRole('button',{name:/Sign in with Keyname/})).toBeVisible()
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null)
  await page.close();page=await context.newPage();await page.goto(`${web}/login`)
  await expect(page.getByRole('button',{name:/Sign in with Keyname/})).toBeVisible()
  revoked=false;await page.getByRole('button',{name:/Sign in with Keyname/}).click()
  await expect(page.getByRole('navigation',{name:'Sessions',exact:true})).toBeVisible()
  const other=await context.newPage();await other.goto(`${web}/login`)
  await expect(other.getByRole('navigation',{name:'Sessions',exact:true})).toBeVisible()
  await other.evaluate(k=>localStorage.removeItem(k),key)
  await expect(page.getByRole('button',{name:/Sign in with Keyname/})).toBeVisible()
  // A late SDK refresh must not restore a session after local logout.
  await page.evaluate(()=>window.Keyname.signIn({mode:'modal'}))
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null)
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('keyname.auth.tokens.v1')),null)
 }finally{await browser.close()}
})
