import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto'
import {AgentSettingsError,type CredentialCodec} from '@multiterm/rue-db/postgres'
/** Preserve the existing iv.tag.ciphertext format and scope AAD exactly. Key
 * acquisition is independent of the database engine and never generates a key. */
export function createCredentialCodec(readKey:()=>Buffer|undefined):CredentialCodec {
 function key(){const value=readKey();if(!value||value.length!==32)throw new AgentSettingsError('agent_key_storage_unavailable');return value}
 return {
  encrypt(scope,secret){
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv)
   cipher.setAAD(Buffer.from(JSON.stringify(scope)))
   const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()])
   return [iv,cipher.getAuthTag(),encrypted].map(value=>value.toString('base64')).join('.')
  },
  decrypt(scope,value){
   const secret=key()
   try {
    const [iv,tag,encrypted]=value.split('.').map(value=>Buffer.from(value,'base64'))
    if(!iv||!tag||!encrypted)throw Error('invalid_ciphertext')
    const cipher=createDecipheriv('aes-256-gcm',secret,iv)
    cipher.setAAD(Buffer.from(JSON.stringify(scope)));cipher.setAuthTag(tag)
    return Buffer.concat([cipher.update(encrypted),cipher.final()]).toString('utf8')
   }catch{throw new AgentSettingsError('agent_key_storage_unavailable')}
  },
 }
}
