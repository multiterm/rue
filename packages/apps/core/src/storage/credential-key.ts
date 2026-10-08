import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs'
import {isAbsolute} from 'node:path'
/** Read an operator-provisioned original key; never generate a replacement. */
export function readCredentialKey(fallbackPath?:string,env:NodeJS.ProcessEnv=process.env):Buffer|undefined {
 const value=env.RUE_SETTINGS_ENCRYPTION_KEY
 if(value){if(!/^[A-Za-z0-9+/]{43}=$/.test(value))return;const key=Buffer.from(value,'base64');return key.length===32?key:undefined}
 const path=env.RUE_SETTINGS_ENCRYPTION_KEY_FILE??fallbackPath
 if(!path||!isAbsolute(path))return
 let fd:number|undefined
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  const stat=fstatSync(fd)
  if(!stat.isFile()||stat.size!==32||stat.nlink!==1||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())return
  return readFileSync(fd)
 }catch{return}finally{if(fd!==undefined)closeSync(fd)}
}
