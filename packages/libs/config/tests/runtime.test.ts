import {afterEach,expect,test,vi} from 'vitest'
import {createRueAppConfig} from '../src/app.js'
afterEach(()=>vi.unstubAllGlobals())
test('runtime service URLs replace build-time sandbox URLs and login uses the current host',()=>{
  vi.stubGlobal('__RUE_PUBLIC_CONFIG__',{SANDBLOCKS_RUNTIME:'production',SANDBLOCKS_SERVICE_API_URL:'https://new-api.example',SANDBLOCKS_SERVICE_WEBAPP_URL:'https://new-app.example'})
  const config=createRueAppConfig({SANDBLOCKS_SERVICE_API_URL:'https://old-api.example',SANDBLOCKS_SERVICE_WEBAPP_URL:'https://old-app.example'},'webapp','https://new-app.example')
  expect(config.urls.api).toBe('https://new-api.example')
  expect(config.urls.login).toBe('https://new-app.example/login')
})
test('promoted hosts use stable sibling services while candidates remain isolated',()=>{
  const env={SANDBLOCKS_RUNTIME:'production',SANDBLOCKS_SERVICE_API_URL:'https://candidate-api.example',SANDBLOCKS_SERVICE_WEBAPP_URL:'https://candidate-app.example',SANDBLOCKS_STABLE_SERVICE_API_URL:'https://api.example',SANDBLOCKS_STABLE_SERVICE_WEBAPP_URL:'https://app.example'}
  expect(createRueAppConfig(env,'webapp','https://candidate-app.example').urls.api).toBe('https://candidate-api.example')
  const promoted=createRueAppConfig(env,'webapp','https://app.example')
  expect(promoted.urls.api).toBe('https://api.example');expect(promoted.urls.login).toBe('https://app.example/login')
})
