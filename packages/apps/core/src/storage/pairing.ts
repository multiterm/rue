import type {Database} from 'better-sqlite3'

export interface DeviceRow {id:string;ownerSubject:string;name:string;platform:string;createdAt:number;lastSeenAt:number;revokedAt:number|null}
export interface PairingRow {id:string;ownerSubject:string;tokenHash:string;codeHash:string;createdDeviceId:string|null;claimedDeviceId:string|null;createdAt:number;expiresAt:number;claimedAt:number|null}
export interface SyncedPreferenceRow {key:string;value:unknown;version:number;updatedAt:number;updatedByDevice:string|null}

type RawDevice={id:string;owner_subject:string;name:string;platform:string;created_at:number;last_seen_at:number;revoked_at:number|null}
type RawPairing={id:string;owner_subject:string;token_hash:string;code_hash:string;created_device_id:string|null;claimed_device_id:string|null;created_at:number;expires_at:number;claimed_at:number|null}
type RawPreference={key:string;value:string;version:number;updated_at:number;updated_by_device:string|null}
const device=(row:RawDevice):DeviceRow=>({id:row.id,ownerSubject:row.owner_subject,name:row.name,platform:row.platform,createdAt:row.created_at,lastSeenAt:row.last_seen_at,revokedAt:row.revoked_at})
const pairing=(row:RawPairing):PairingRow=>({id:row.id,ownerSubject:row.owner_subject,tokenHash:row.token_hash,codeHash:row.code_hash,createdDeviceId:row.created_device_id,claimedDeviceId:row.claimed_device_id,createdAt:row.created_at,expiresAt:row.expires_at,claimedAt:row.claimed_at})

export function registerDevice(db:Database,id:string,ownerSubject:string,name:string,platform:string,now=Date.now()):DeviceRow{
  db.prepare(`INSERT INTO devices (id,owner_subject,name,platform,created_at,last_seen_at,revoked_at) VALUES (?,?,?,?,?,?,NULL)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,last_seen_at=excluded.last_seen_at,revoked_at=NULL
    WHERE devices.owner_subject=excluded.owner_subject`).run(id,ownerSubject,name,platform,now,now)
  const row=db.prepare('SELECT * FROM devices WHERE id=? AND owner_subject=?').get(id,ownerSubject) as RawDevice|undefined
  if(!row)throw new Error('device_owner_mismatch')
  return device(row)
}
export function listDevices(db:Database,ownerSubject:string):DeviceRow[]{return (db.prepare('SELECT * FROM devices WHERE owner_subject=? AND revoked_at IS NULL ORDER BY last_seen_at DESC').all(ownerSubject) as RawDevice[]).map(device)}
export function revokeDevice(db:Database,id:string,ownerSubject:string,now=Date.now()):boolean{return db.prepare('UPDATE devices SET revoked_at=? WHERE id=? AND owner_subject=? AND revoked_at IS NULL').run(now,id,ownerSubject).changes>0}
export function createPairing(db:Database,row:PairingRow):PairingRow{db.prepare(`INSERT INTO device_pairings (id,owner_subject,token_hash,code_hash,created_device_id,claimed_device_id,created_at,expires_at,claimed_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(row.id,row.ownerSubject,row.tokenHash,row.codeHash,row.createdDeviceId,row.claimedDeviceId,row.createdAt,row.expiresAt,row.claimedAt);return row}
export function findPairing(db:Database,ownerSubject:string,tokenHash?:string,codeHash?:string):PairingRow|undefined{const raw=(tokenHash?db.prepare('SELECT * FROM device_pairings WHERE owner_subject=? AND token_hash=?').get(ownerSubject,tokenHash):db.prepare('SELECT * FROM device_pairings WHERE owner_subject=? AND code_hash=? ORDER BY created_at DESC LIMIT 1').get(ownerSubject,codeHash)) as RawPairing|undefined;return raw?pairing(raw):undefined}
export function getPairing(db:Database,id:string,ownerSubject:string):PairingRow|undefined{const row=db.prepare('SELECT * FROM device_pairings WHERE id=? AND owner_subject=?').get(id,ownerSubject) as RawPairing|undefined;return row?pairing(row):undefined}
export function claimPairing(db:Database,id:string,ownerSubject:string,deviceId:string,now=Date.now()):boolean{return db.prepare('UPDATE device_pairings SET claimed_device_id=?,claimed_at=? WHERE id=? AND owner_subject=? AND claimed_at IS NULL AND expires_at>?').run(deviceId,now,id,ownerSubject,now).changes>0}
export function listPreferences(db:Database,ownerSubject:string):SyncedPreferenceRow[]{return (db.prepare('SELECT key,value,version,updated_at,updated_by_device FROM synced_preferences WHERE owner_subject=? ORDER BY key').all(ownerSubject) as RawPreference[]).map((row)=>({key:row.key,value:JSON.parse(row.value),version:row.version,updatedAt:row.updated_at,updatedByDevice:row.updated_by_device}))}
export function setPreference(db:Database,ownerSubject:string,key:string,value:unknown,deviceId:string|undefined,expectedVersion:number|undefined,now=Date.now()):SyncedPreferenceRow|undefined{
  const current=db.prepare('SELECT version FROM synced_preferences WHERE owner_subject=? AND key=?').get(ownerSubject,key) as {version:number}|undefined
  if(expectedVersion!==undefined&&(current?.version??0)!==expectedVersion)return undefined
  const version=(current?.version??0)+1
  db.prepare(`INSERT INTO synced_preferences (owner_subject,key,value,version,updated_at,updated_by_device) VALUES (?,?,?,?,?,?) ON CONFLICT(owner_subject,key) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at,updated_by_device=excluded.updated_by_device`).run(ownerSubject,key,JSON.stringify(value),version,now,deviceId??null)
  return {key,value,version,updatedAt:now,updatedByDevice:deviceId??null}
}
