import {createHash,randomBytes,randomInt} from 'node:crypto'
import {Hono} from 'hono'
import {sessionServices} from '../session-services.js'
import type {ServerContext} from '../context.js'

const TOKEN_TTL_MS=5*60*1000
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const id=(prefix:string)=>`${prefix}_${randomBytes(18).toString('base64url')}`
const validDevice=(value:unknown)=>typeof value==='string'&&value.length>=3&&value.length<=128
const validName=(value:unknown)=>typeof value==='string'&&value.trim().length>=1&&value.trim().length<=80
const validPlatform=(value:unknown)=>typeof value==='string'&&/^(web|desktop|ios|android|terminal)$/.test(value)
const readJson=async(request:Request):Promise<Record<string,unknown>>=>{try{const value=await request.json();return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}catch{return {}}}
function deviceInput(body:Record<string,unknown>){return {id:String(body.deviceId),name:String(body.name).trim(),platform:String(body.platform)}}
function validInput(body:Record<string,unknown>){return validDevice(body.deviceId)&&validName(body.name)&&validPlatform(body.platform)}

export function pairingRoutes():Hono<{Variables:{ctx:ServerContext}}>{
 const app=new Hono<{Variables:{ctx:ServerContext}}>()
 app.post('/device/register',async c=>{
  const body=await readJson(c.req.raw)
  if(!validInput(body))return c.json({error:'INVALID_DEVICE'},400)
  return c.json(await sessionServices(c.var.ctx).pairing.registerDevice(c.get('principal').subject,deviceInput(body)))
 })
 app.get('/device',async c=>c.json(await sessionServices(c.var.ctx).pairing.listDevices(c.get('principal').subject)))
 app.delete('/device/:id',async c=>{
  const owner=c.get('principal').subject,deviceId=c.req.param('id')
  const revoked=await sessionServices(c.var.ctx).pairing.revokeDevice(owner,deviceId)
  if(revoked)c.var.ctx.bus.publish('device.revoked',{ownerSubject:owner,deviceId})
  return c.json({revoked})
 })
 app.post('/pairing',async c=>{
  const body=await readJson(c.req.raw)
  if(!validInput(body))return c.json({error:'INVALID_DEVICE'},400)
  const owner=c.get('principal').subject,store=sessionServices(c.var.ctx).pairing
  const source=await store.registerDevice(owner,deviceInput(body))
  const token=randomBytes(32).toString('base64url'),code=String(randomInt(0,100_000_000)).padStart(8,'0'),now=Date.now()
  const row=await store.createPairing(owner,{id:id('pair'),tokenHash:hash(token),codeHash:hash(code),createdDeviceId:source.id,expiresAt:now+TOKEN_TTL_MS},now)
  return c.json({id:row.id,token,code,expiresAt:row.expiresAt})
 })
 app.get('/pairing/:id',async c=>{
  const row=await sessionServices(c.var.ctx).pairing.getPairing(c.get('principal').subject,c.req.param('id'))
  if(!row)return c.json({error:'PAIRING_NOT_FOUND'},404)
  return c.json({id:row.id,expiresAt:row.expiresAt,claimedAt:row.claimedAt,claimedDeviceId:row.claimedDeviceId})
 })
 app.post('/pairing/redeem',async c=>{
  const body=await readJson(c.req.raw)
  if(!validInput(body)||(typeof body.token!=='string'&&typeof body.code!=='string'))return c.json({error:'INVALID_PAIRING'},400)
  const owner=c.get('principal').subject,token=typeof body.token==='string'?body.token.trim():undefined,code=typeof body.code==='string'?body.code.replace(/\D/g,''):undefined
  const result=await sessionServices(c.var.ctx).pairing.redeemPairing(owner,token?{tokenHash:hash(token)}:{codeHash:hash(code??'')},deviceInput(body))
  if(!result)return c.json({error:'PAIRING_INVALID_OR_EXPIRED'},410)
  c.var.ctx.bus.publish('device.paired',{ownerSubject:owner,deviceId:result.device.id,pairingId:result.pairingId})
  return c.json({...result,synced:true})
 })
 app.get('/sync/preferences',async c=>c.json(await sessionServices(c.var.ctx).pairing.listPreferences(c.get('principal').subject)))
 app.put('/sync/preferences/:key',async c=>{
  const key=c.req.param('key'),body=await readJson(c.req.raw)
  if(!/^[a-z0-9._-]{1,64}$/i.test(key)||!('value' in body))return c.json({error:'INVALID_PREFERENCE'},400)
  if(body.expectedVersion!==undefined&&(!Number.isSafeInteger(body.expectedVersion)||Number(body.expectedVersion)<0))return c.json({error:'INVALID_PREFERENCE'},400)
  if(body.deviceId!==undefined&&!validDevice(body.deviceId))return c.json({error:'INVALID_PREFERENCE'},400)
  const expectedVersion=typeof body.expectedVersion==='number'?body.expectedVersion:undefined,deviceId=typeof body.deviceId==='string'?body.deviceId:undefined
  const owner=c.get('principal').subject,store=sessionServices(c.var.ctx).pairing
  const preference=await store.setPreference(owner,key,body.value,deviceId,expectedVersion)
  if(!preference)return c.json({error:'PREFERENCE_CONFLICT',preferences:await store.listPreferences(owner)},409)
  c.var.ctx.bus.publish('preference.updated',{ownerSubject:owner,key,version:preference.version})
  return c.json(preference)
 })
 return app
}
