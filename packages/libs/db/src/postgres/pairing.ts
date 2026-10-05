import {and,asc,desc,eq,gt,isNull,sql} from 'drizzle-orm'
import type {RuePostgresDatabase} from './client.js'
import {devices,devicePairings,syncedPreferences} from './schema.js'
const principal=(owner:string)=>{if(!owner||owner.length>512)throw Error('pairing_owner_required')}
/** Async device/pairing/preferences storage. The API remains on SQLite until the full cutover. */
export function createPostgresPairingRepository(db:RuePostgresDatabase){
 return {
  async registerDevice(owner:string,input:{id:string;name:string;platform:string},now=Date.now()){
   principal(owner)
   const [row]=await db.insert(devices).values({...input,ownerSubject:owner,createdAt:now,lastSeenAt:now,revokedAt:null}).onConflictDoUpdate({target:devices.id,set:{name:input.name,platform:input.platform,lastSeenAt:now,revokedAt:null},setWhere:eq(devices.ownerSubject,owner)}).returning()
   if(!row)throw Error('device_owner_mismatch')
   return row
  },
  async listDevices(owner:string){principal(owner);return db.select().from(devices).where(and(eq(devices.ownerSubject,owner),isNull(devices.revokedAt))).orderBy(desc(devices.lastSeenAt),asc(devices.id))},
  async revokeDevice(owner:string,id:string,now=Date.now()){
   principal(owner);return (await db.update(devices).set({revokedAt:now}).where(and(eq(devices.id,id),eq(devices.ownerSubject,owner),isNull(devices.revokedAt))).returning({id:devices.id})).length===1
  },
  async createPairing(owner:string,input:{id:string;tokenHash:string;codeHash:string;createdDeviceId?:string|null;expiresAt:number},now=Date.now()){
   principal(owner)
   return (await db.insert(devicePairings).values({...input,ownerSubject:owner,createdAt:now,claimedDeviceId:null,claimedAt:null}).returning())[0]!
  },
  async getPairing(owner:string,id:string){principal(owner);return (await db.select().from(devicePairings).where(and(eq(devicePairings.ownerSubject,owner),eq(devicePairings.id,id))).limit(1))[0]},
  async findPairing(owner:string,lookup:{tokenHash:string}|{codeHash:string}){
   principal(owner)
   return (await db.select().from(devicePairings).where(and(eq(devicePairings.ownerSubject,owner),'tokenHash' in lookup?eq(devicePairings.tokenHash,lookup.tokenHash):eq(devicePairings.codeHash,lookup.codeHash))).orderBy(desc(devicePairings.createdAt),desc(devicePairings.id)).limit(1))[0]
  },
  async claimPairing(owner:string,id:string,deviceId:string,now=Date.now()){
   principal(owner)
   // One statement: concurrent claimers cannot both acquire a pairing.
   return (await db.update(devicePairings).set({claimedDeviceId:deviceId,claimedAt:now}).where(and(eq(devicePairings.id,id),eq(devicePairings.ownerSubject,owner),isNull(devicePairings.claimedAt),gt(devicePairings.expiresAt,now))).returning({id:devicePairings.id})).length===1
  },
  async listPreferences(owner:string){
   principal(owner)
   return (await db.select().from(syncedPreferences).where(eq(syncedPreferences.ownerSubject,owner)).orderBy(asc(syncedPreferences.key))).map(({ownerSubject,value,...row})=>({...row,value:JSON.parse(value) as unknown}))
  },
  async setPreference(owner:string,key:string,value:unknown,deviceId?:string,expectedVersion?:number,now=Date.now()){
   principal(owner)
   if(expectedVersion!==undefined&&(!Number.isSafeInteger(expectedVersion)||expectedVersion<0))throw Error('preference_version_invalid')
   const encoded=JSON.stringify(value);if(encoded===undefined)throw Error('preference_value_invalid')
   const fields={value:encoded,updatedAt:now,updatedByDevice:deviceId??null}
   // No SELECT-then-UPDATE race: both creation and replacement are compare-and-set.
   const rows=expectedVersion===0
    ? await db.insert(syncedPreferences).values({ownerSubject:owner,key,version:1,...fields}).onConflictDoNothing().returning()
    : expectedVersion!==undefined
    ? await db.update(syncedPreferences).set({...fields,version:sql`${syncedPreferences.version}+1`}).where(and(eq(syncedPreferences.ownerSubject,owner),eq(syncedPreferences.key,key),eq(syncedPreferences.version,expectedVersion))).returning()
    : await db.insert(syncedPreferences).values({ownerSubject:owner,key,version:1,...fields}).onConflictDoUpdate({target:[syncedPreferences.ownerSubject,syncedPreferences.key],set:{...fields,version:sql`${syncedPreferences.version}+1`}}).returning()
   if(!rows[0])return undefined
   const {ownerSubject,...row}=rows[0];return {...row,value:JSON.parse(row.value) as unknown}
  },
 }
}
