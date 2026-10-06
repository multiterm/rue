import type {Database} from 'better-sqlite3'
import type {createPostgresPairingRepository} from '@multiterm/rue-db/postgres'
import * as legacy from '../storage/pairing.js'
export function createSqlitePairingServices(db:Database):ReturnType<typeof createPostgresPairingRepository>{
 return {
  async registerDevice(owner,input,now){return legacy.registerDevice(db,input.id,owner,input.name,input.platform,now)},
  async listDevices(owner){return legacy.listDevices(db,owner)},
  async revokeDevice(owner,id,now){return legacy.revokeDevice(db,id,owner,now)},
  async createPairing(owner,input,now=Date.now()){return legacy.createPairing(db,{...input,ownerSubject:owner,createdDeviceId:input.createdDeviceId??null,createdAt:now,claimedAt:null,claimedDeviceId:null})},
  async getPairing(owner,id){return legacy.getPairing(db,id,owner)},
  async findPairing(owner,lookup){return legacy.findPairing(db,owner,'tokenHash' in lookup?lookup.tokenHash:undefined,'codeHash' in lookup?lookup.codeHash:undefined)},
  async claimPairing(owner,id,deviceId,now){return legacy.claimPairing(db,id,owner,deviceId,now)},
  async redeemPairing(owner,lookup,input,at){
   const unavailable=Symbol('pairing_unavailable')
   try{return db.transaction(()=>{
    const pair=legacy.findPairing(db,owner,'tokenHash' in lookup?lookup.tokenHash:undefined,'codeHash' in lookup?lookup.codeHash:undefined)
    if(!pair||pair.claimedAt!==null||pair.expiresAt<=(at??Date.now()))return undefined
    const device=legacy.registerDevice(db,input.id,owner,input.name,input.platform,at??Date.now())
    if(!legacy.claimPairing(db,pair.id,owner,input.id,at??Date.now()))throw unavailable
    return {device,pairingId:pair.id}
   }).immediate()}catch(error){if(error===unavailable)return undefined;throw error}
  },
  async listPreferences(owner){return legacy.listPreferences(db,owner)},
  async setPreference(owner,key,value,deviceId,version,now){return legacy.setPreference(db,owner,key,value,deviceId,version,now)},
 }
}
