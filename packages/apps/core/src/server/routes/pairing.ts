import {createHash,randomBytes,randomInt} from 'node:crypto'
import {Hono} from 'hono'
import {claimPairing,createPairing,findPairing,getPairing,listDevices,listPreferences,registerDevice,revokeDevice,setPreference} from '../../storage/index.js'
import type {ServerContext} from '../context.js'

const TOKEN_TTL_MS=5*60*1000
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const id=(prefix:string)=>`${prefix}_${randomBytes(18).toString('base64url')}`
const validDevice=(value:unknown)=>typeof value==='string'&&value.length>=3&&value.length<=128
const validName=(value:unknown)=>typeof value==='string'&&value.trim().length>=1&&value.trim().length<=80
const validPlatform=(value:unknown)=>typeof value==='string'&&/^(web|desktop|ios|android|terminal)$/.test(value)
const readJson=async(request:Request):Promise<Record<string,unknown>>=>{try{return await request.json() as Record<string,unknown>}catch{return {}}}

export function pairingRoutes():Hono<{Variables:{ctx:ServerContext}}>{
  const app=new Hono<{Variables:{ctx:ServerContext}}>()
  app.post('/device/register',async(c)=>{const body=await readJson(c.req.raw);if(!validDevice(body.deviceId)||!validName(body.name)||!validPlatform(body.platform))return c.json({error:'INVALID_DEVICE'},400);const owner=c.get('principal').subject;const row=registerDevice(c.var.ctx.db,String(body.deviceId),owner,String(body.name).trim(),String(body.platform));return c.json(row)})
  app.get('/device',(c)=>c.json(listDevices(c.var.ctx.db,c.get('principal').subject)))
  app.delete('/device/:id',(c)=>{const owner=c.get('principal').subject;const revoked=revokeDevice(c.var.ctx.db,c.req.param('id'),owner);if(revoked)c.var.ctx.bus.publish('device.revoked',{ownerSubject:owner,deviceId:c.req.param('id')});return c.json({revoked})})
  app.post('/pairing',async(c)=>{const body=await readJson(c.req.raw);if(!validDevice(body.deviceId)||!validName(body.name)||!validPlatform(body.platform))return c.json({error:'INVALID_DEVICE'},400);const owner=c.get('principal').subject;const source=registerDevice(c.var.ctx.db,String(body.deviceId),owner,String(body.name).trim(),String(body.platform));const token=randomBytes(32).toString('base64url');const code=String(randomInt(0,100_000_000)).padStart(8,'0');const now=Date.now();const row=createPairing(c.var.ctx.db,{id:id('pair'),ownerSubject:owner,tokenHash:hash(token),codeHash:hash(code),createdDeviceId:source.id,claimedDeviceId:null,createdAt:now,expiresAt:now+TOKEN_TTL_MS,claimedAt:null});return c.json({id:row.id,token,code,expiresAt:row.expiresAt})})
  app.get('/pairing/:id',(c)=>{const row=getPairing(c.var.ctx.db,c.req.param('id'),c.get('principal').subject);if(!row)return c.json({error:'PAIRING_NOT_FOUND'},404);return c.json({id:row.id,expiresAt:row.expiresAt,claimedAt:row.claimedAt,claimedDeviceId:row.claimedDeviceId})})
  app.post('/pairing/redeem',async(c)=>{const body=await readJson(c.req.raw);if(!validDevice(body.deviceId)||!validName(body.name)||!validPlatform(body.platform)||(typeof body.token!=='string'&&typeof body.code!=='string'))return c.json({error:'INVALID_PAIRING'},400);const owner=c.get('principal').subject;const token=typeof body.token==='string'?body.token.trim():undefined;const code=typeof body.code==='string'?body.code.replace(/\D/g,''):undefined;const row=findPairing(c.var.ctx.db,owner,token?hash(token):undefined,token?undefined:hash(code??''));if(!row||row.claimedAt||row.expiresAt<=Date.now())return c.json({error:'PAIRING_INVALID_OR_EXPIRED'},410);const target=registerDevice(c.var.ctx.db,String(body.deviceId),owner,String(body.name).trim(),String(body.platform));if(!claimPairing(c.var.ctx.db,row.id,owner,target.id))return c.json({error:'PAIRING_INVALID_OR_EXPIRED'},410);c.var.ctx.bus.publish('device.paired',{ownerSubject:owner,deviceId:target.id,pairingId:row.id});return c.json({device:target,pairingId:row.id,synced:true})})
  app.get('/sync/preferences',(c)=>c.json(listPreferences(c.var.ctx.db,c.get('principal').subject)))
  app.put('/sync/preferences/:key',async(c)=>{const key=c.req.param('key');const body=await readJson(c.req.raw);if(!/^[a-z0-9._-]{1,64}$/i.test(key)||!('value'in body))return c.json({error:'INVALID_PREFERENCE'},400);const expectedVersion=typeof body.expectedVersion==='number'?body.expectedVersion:undefined;const deviceId=typeof body.deviceId==='string'?body.deviceId:undefined;const owner=c.get('principal').subject;const preference=setPreference(c.var.ctx.db,owner,key,body.value,deviceId,expectedVersion);if(!preference)return c.json({error:'PREFERENCE_CONFLICT',preferences:listPreferences(c.var.ctx.db,owner)},409);c.var.ctx.bus.publish('preference.updated',{ownerSubject:owner,key,version:preference.version});return c.json(preference)})
  return app
}
