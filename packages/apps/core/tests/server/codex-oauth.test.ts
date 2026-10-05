import {expect,test,vi} from 'vitest'
import {openaiCodexProvider} from '@earendil-works/pi-ai/providers/openai-codex'
import {refreshCodexOAuth} from '../../src/provider/codex-oauth.js'
const token=()=>[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,'https://api.openai.com/auth':{chatgpt_account_id:'account_one'}})).toString('base64url'),'synthetic'].join('.')
const credential=()=>({type:'oauth' as const,access:token(),refresh:'private-refresh',accountId:'account_one',expires:Date.now()+3600000})
test('Codex refresh uses fixed issuer, no redirects and a bounded canonical credential',async()=>{
 const fetcher=vi.fn(async()=>Response.json({access_token:token(),refresh_token:'rotated-private-refresh',expires_in:3600,id_token:'not-persisted'}))
 const result=await refreshCodexOAuth(credential(),AbortSignal.timeout(1000),fetcher)
 const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit]
 expect(url).toBe('https://auth.openai.com/oauth/token');expect(init).toMatchObject({method:'POST',redirect:'error',cache:'no-store'})
 expect((init.body as URLSearchParams).get('grant_type')).toBe('refresh_token');expect((init.body as URLSearchParams).get('refresh_token')).toBe('private-refresh')
 expect(result).toMatchObject({type:'oauth',accountId:'account_one',refresh:'rotated-private-refresh'});expect(result).not.toHaveProperty('id_token')
})
test.each([()=>new Response('private-provider-error',{status:401}),()=>new Response('redirect',{status:307}),()=>new Response('x'.repeat(50000)),()=>Response.json({access_token:'sensitive-bad-access',refresh_token:'secret',expires_in:3600})])('provider failures, redirects and oversized/malformed tokens are redacted',async response=>{
 await expect(refreshCodexOAuth(credential(),AbortSignal.timeout(1000),vi.fn(async()=>response()))).rejects.toThrow('oauth_refresh_failed')
})
test('refresh issuer and public client match the pinned native Pi Codex provider',async()=>{
 const calls:Array<[string,RequestInit|undefined]>=[]
 const mock=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{calls.push([String(url),init]);return Response.json({access_token:token(),refresh_token:'rotated-private-refresh',expires_in:3600})})
 try{
  await openaiCodexProvider().auth.oauth!.refresh(credential(),AbortSignal.timeout(1000))
  await refreshCodexOAuth(credential(),AbortSignal.timeout(1000))
  expect(calls).toHaveLength(2);expect(calls[1]![0]).toBe(calls[0]![0]);expect(Object.fromEntries(new URLSearchParams(String(calls[1]![1]!.body)))).toEqual(Object.fromEntries(new URLSearchParams(String(calls[0]![1]!.body))))
  expect(calls[1]![1]!.redirect).toBe('error')
 }finally{mock.mockRestore()}
})
test('cancelled refresh does not send a token',async()=>{const fetcher=vi.fn();await expect(refreshCodexOAuth(credential(),AbortSignal.abort(),fetcher)).rejects.toThrow('oauth_refresh_failed');expect(fetcher).not.toHaveBeenCalled()})
