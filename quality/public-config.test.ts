import {expect,test} from 'vitest'
import {publicConfig,publicConfigScript} from '../scripts/deployment/public-config.mjs'
test('runtime configuration exposes only explicitly allowed public values',()=>{
 const env={SANDBLOCKS_RUNTIME:'production',SANDBLOCKS_SERVICE_API_URL:'https://api.example/',SANDBLOCKS_STABLE_SERVICE_WEBAPP_URL:'https://app.example',RUE_SETTINGS_ENCRYPTION_KEY:'private',SANDBLOCKS_API_KEY:'private',DATABASE_URL:'private'}
 expect(publicConfig(env)).toEqual({SANDBLOCKS_RUNTIME:'production',SANDBLOCKS_SERVICE_API_URL:'https://api.example',SANDBLOCKS_STABLE_SERVICE_WEBAPP_URL:'https://app.example'})
 expect(publicConfigScript(env)).not.toContain('private')
 expect(publicConfigScript(env)).toContain('window.__RUE_PUBLIC_CONFIG__=')
})
test('credentials and non-HTTP service URLs fail closed',()=>{
 for(const value of ['https://user:password@example.test','javascript:alert(1)','file:///secret'])expect(()=>publicConfig({SANDBLOCKS_SERVICE_API_URL:value})).toThrow()
})
