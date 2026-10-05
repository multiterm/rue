import {readFile,readdir,lstat} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {homedir} from 'node:os'
import {isIP} from 'node:net'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

/** Literal connection fields only. Inheritance/Jinja and ambiguous records require operator review. */
export function fleetConnection(source){
 const values={},errors=[]
 for(const line of source.split(/\r?\n/)){
  const key=line.match(/^(ansible_host|ansible_port|ansible_user):/)?.[1];if(!key)continue
  if(Object.hasOwn(values,key)){errors.push('duplicate_'+key);continue}
  const match=line.match(/^[a-z_]+:\s*(?:'([^']*)'|"([^"\\]*)"|([^\s#]+))\s*(?:#.*)?$/)
  values[key]=match?.[1]??match?.[2]??match?.[3]??null
 }
 const host=values.ansible_host,port=Number(values.ansible_port),user=values.ansible_user
 if(!isIP(host??''))errors.push('literal_ip_required')
 if(!Number.isInteger(port)||port<1||port>65535)errors.push('explicit_port_required')
 if(typeof user!=='string'||!/^[_a-z][_a-z0-9-]*[$]?$/.test(user))errors.push('literal_user_required')
 if(errors.length)return {ready:false,blockers:errors}
 return {ready:true,host,port,user,blockers:[]}
}
export function trustedHost(connection,knownHosts,run=spawnSync){
 if(!connection.ready)return false
 const target=connection.port===22?connection.host:`[${connection.host}]:${connection.port}`
 const result=run('/usr/bin/ssh-keygen',['-F',target,'-f',knownHosts],{encoding:'utf8',timeout:5000})
 if(result.status!==0)return false
 const lines=result.stdout.split(/\r?\n/).filter(line=>line&&!line.startsWith('#'))
 return lines.length>0&&!lines.some(line=>line.startsWith('@revoked '))
}
export async function inventoryFleet(provisionDir,knownHosts){
 const root=join(resolve(provisionDir),'inventory/host_vars'),entries=await readdir(root,{withFileTypes:true}),hosts=[]
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.name.startsWith('.')||entry.isSymbolicLink())continue
  const id=entry.name.replace(/\.ya?ml$/,'');if(!/^[a-z0-9][a-z0-9_-]*$/.test(id))continue
  let files=[]
  if(entry.isFile()&&/\.ya?ml$/.test(entry.name))files=[join(root,entry.name)]
  else if(entry.isDirectory())files=(await readdir(join(root,entry.name),{withFileTypes:true})).filter(file=>file.isFile()&&/\.ya?ml$/.test(file.name)).map(file=>join(root,entry.name,file.name)).sort()
  if(!files.length)continue
  const records=await Promise.all(files.map(async file=>{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('inventory_changed');return readFile(file,'utf8')}))
  const connection=fleetConnection(records.join('\n')),hostKeyTrusted=trustedHost(connection,knownHosts)
  hosts.push({inventoryHost:id,...connection,hostKeyTrusted,authorizationInstalled:false})
 }
 return {hosts,counts:{total:hosts.length,resolved:hosts.filter(h=>h.ready).length,trusted:hosts.filter(h=>h.hostKeyTrusted).length},botCreated:false,grantsInstalled:false,note:'Read-only local inventory and existing host-key trust; no network probes, private-key reads or SSH enrollment. Review active inventory membership and desired privileges before approval.'}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{'provision-dir':{type:'string'},'known-hosts':{type:'string'}}})
 if(!values['provision-dir'])throw Error('--provision-dir is required')
 console.log(JSON.stringify(await inventoryFleet(values['provision-dir'],values['known-hosts']??join(homedir(),'.ssh/known_hosts')),null,2))
}
