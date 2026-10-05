import {expect,test} from 'vitest'
import {tenancyVerifier} from '../../src/server/tenancy-verifier.js'
const token='tnk_'+'a'.repeat(43),secret='synthetic-verifier-credential-1234567890'
const claims=()=>({id:'key_one',owner:{type:'project',organizationId:'org_one',projectId:'prj_one'},name:'Test',service:'rue',grants:['arbitrary.permission'],createdAt:Date.now(),revokedAt:null,expiresAt:Date.now()+60000})
test('Tenancy proofs are audience-bound, HTTPS-only, bounded and nonredirecting',async()=>{
 let calls=0
 const verifier=tenancyVerifier('https://tenancy.test',secret,async(url,options)=>{
  calls++;expect(url).toBe('https://tenancy.test/v1/service/rue/keys/verify');expect(options?.redirect).toBe('error');expect(options?.cache).toBe('no-store');expect(options?.headers).toMatchObject({'x-tenancy-service':'rue',authorization:`Bearer ${secret}`});expect(JSON.parse(String(options?.body))).toEqual({token});return Response.json({key:claims()})
 })
 expect(await verifier.verifyKey(token)).toMatchObject({service:'rue',owner:{type:'project',projectId:'prj_one'}})
 expect(await verifier.verifyKey('rue_worker_'+'a'.repeat(43))).toBeUndefined();expect(calls).toBe(1)
 expect(()=>tenancyVerifier('http://tenancy.test',secret)).toThrow();expect(()=>tenancyVerifier('https://tenancy.test/path',secret)).toThrow()
})
test('invalid keys differ from verifier failures; malformed claims never authorize',async()=>{
 expect(await tenancyVerifier('https://tenancy.test',secret,async()=>Response.json({error:'TENANCY_API_KEY_INVALID'},{status:401})).verifyKey(token)).toBeUndefined()
 for(const body of [{error:'TENANCY_SERVICE_AUTH_INVALID'},{error:token}])await expect(tenancyVerifier('https://tenancy.test',secret,async()=>Response.json(body,{status:401})).verifyKey(token)).rejects.toThrow('tenancy_verification_unavailable')
 for(const key of [{...claims(),service:'herald'},{...claims(),owner:{type:'other'}},{...claims(),grants:['read\n']},{...claims(),grants:['x','x']}])await expect(tenancyVerifier('https://tenancy.test',secret,async()=>Response.json({key})).verifyKey(token)).rejects.toThrow('tenancy_verification_unavailable')
 await expect(tenancyVerifier('https://tenancy.test',secret,async()=>new Response('x'.repeat(32769))).verifyKey(token)).rejects.toThrow('tenancy_verification_unavailable')
})
