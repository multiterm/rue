import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {afterEach,expect,test} from 'vitest'
import {enrollKey} from '../src/key-enrollment.js'
const directories:string[]=[]
afterEach(()=>directories.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})))
function setup(){const path=mkdtempSync(tmpdir()+'/rue-key-');directories.push(path);writeFileSync(path+'/key','tnk_'+'a'.repeat(43),{mode:0o600});return {RUE_WORKER_API_URL:'https://rue.test',RUE_API_KEY_FILE:path+'/key',RUE_WORKER_NAME:'Host',RUE_ACKNOWLEDGE_HOST_CONTROL:'true',RUE_WORKER_STATE_DIR:path+'/state'}}
test('one Tenancy key enrolls without a project binding and durable retries retain only transport identity',async()=>{
 const env=setup(),requests:string[]=[],worker=randomUUID(),secret='rue_worker_'+'b'.repeat(43)
 const fetcher:typeof fetch=async(url,options)=>{expect(url).toBe('https://rue.test/workers');expect(options?.redirect).toBe('error');expect(options?.cache).toBe('no-store');requests.push(JSON.parse(String(options?.body)).requestId);if(requests.length===1)throw Error('lost response');return Response.json({worker:{id:worker,keyAuthorityId:randomUUID()},secret})}
 await expect(enrollKey(env,fetcher)).rejects.toThrow();expect(await enrollKey(env,fetcher)).toEqual({id:worker});expect(requests[0]).toBe(requests[1])
 const link=readFileSync(env.RUE_WORKER_STATE_DIR+'/link.json','utf8');expect(JSON.parse(link).secret).toBe(secret);expect(link).not.toContain('tnk_');expect(readFileSync(env.RUE_WORKER_STATE_DIR+'/key-enrollment.json','utf8')).not.toContain('tnk_');await expect(enrollKey(env,fetcher)).rejects.toThrow('worker_already_enrolled')
})
test('concurrent enrollment is excluded and lost credentials require explicit recovery',async()=>{
 const env=setup();let release!:()=>void
 const pending=enrollKey(env,async()=>{await new Promise<void>(resolve=>{release=resolve});return Response.json({worker:{id:randomUUID(),keyAuthorityId:randomUUID()}})})
 await expect(enrollKey(env,async()=>Response.json({}))).rejects.toThrow('worker_key_enrollment_locked');release();await expect(pending).rejects.toThrow('worker_key_enrollment_recovery_required')
 await expect(enrollKey({...env,RUE_WORKER_NAME:'Changed'},async()=>Response.json({}))).rejects.toThrow('worker_key_intent_conflict')
 writeFileSync(env.RUE_API_KEY_FILE,'tnk_'+'z'.repeat(43));await expect(enrollKey(env,async()=>Response.json({}))).rejects.toThrow('worker_key_intent_conflict')
})
