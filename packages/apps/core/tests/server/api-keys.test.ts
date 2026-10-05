import {randomUUID} from 'node:crypto'
import {afterEach,expect,test,vi} from 'vitest'
import {createApp} from '../../src/server/app.js'
import {ConfigSchema} from '../../src/config/index.js'
import {openDatabase} from '../../src/storage/db.js'
import {Bus} from '../../src/bus/index.js'
import {ProjectAuthority} from '../../src/server/project-authority.js'
const dbs:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{dbs.splice(0).forEach(db=>db.close());vi.restoreAllMocks()})
test('human key management forwards to Tenancy, pins audience, keeps metadata secret-free and rejects unknown Rue grants',async()=>{
 const db=openDatabase(':memory:');dbs.push(db);const config=ConfigSchema.parse({keyname:{enabled:true,apiUrl:'https://identity.test'}}),app=createApp({ctx:{db,config,bus:new Bus(),projectAuthority:new ProjectAuthority(db,{origin:'https://tenancy.test',verifyKey:async()=>undefined})}})
 const issued={id:'key_one',owner:{type:'self',subject:'usr_owner'},name:'Mason',service:'rue',grants:['rue:hosts:read'],createdAt:Date.now(),expiresAt:Date.now()+60000,revokedAt:null},token='tnk_'+'s'.repeat(43),calls:any[]=[]
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  if(String(url)==='https://identity.test/v1/token/verify')return Response.json({token:{subject:'usr_owner',principalType:'user'}})
  calls.push([url,init]);expect(init?.redirect).toBe('error');expect(init?.headers).toMatchObject({authorization:'Bearer human-session'})
  if(init?.method==='POST'){expect(JSON.parse(String(init.body))).toMatchObject({service:'rue',owner:{type:'self'}});return Response.json({...issued,token},{status:201})}
  if(init?.method==='DELETE')return new Response(null,{status:204})
  return Response.json({keys:[issued]})
 })
 const request=(method:string,path='/api-keys',body?:unknown)=>app.request('https://rue.test'+path,{method,headers:{authorization:'Bearer human-session','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
 const input={owner:{type:'self'},name:'Mason',grants:['rue:hosts:read'],expiresAt:issued.expiresAt,requestId:randomUUID()}
 const created=await request('POST','/api-keys',input);expect(created.status).toBe(201);expect(created.headers.get('cache-control')).toContain('no-store');expect((await created.json()).token).toBe(token)
 const listed=await request('GET');expect(await listed.json()).toEqual({keys:[issued]});expect(calls).toHaveLength(2)
 expect((await request('POST','/api-keys',{...input,grants:['rue:admin']})).status).toBe(400);expect(calls).toHaveLength(2)
 expect((await request('DELETE','/api-keys/key_one')).status).toBe(204)
})
