import {readFile,stat,mkdir,writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {resolve,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {isIP} from 'node:net'
import {spawn} from 'node:child_process'
import {parseArgs} from 'node:util'

class ControllerAccessError extends Error {}
const targets={abby:'vb-abby/00-connection.yml',stratus:'vultr-stratus/00-connection.yml'}
/** Deliberately accepts only literal top-level connection scalars, not arbitrary YAML/Jinja. */
export function connection(text,home=homedir()){
 const fields={}
 for(const line of text.split(/\r?\n/)){
  if(!/^(ansible_host|ansible_port|ansible_user|ansible_ssh_private_key_file):/.test(line))continue
  const m=line.match(/^(ansible_host|ansible_port|ansible_user|ansible_ssh_private_key_file):\s*(?:'([^']*)'|"([^"\\]*)"|([^\s#]+))\s*(?:#.*)?$/)
  if(!m||Object.hasOwn(fields,m[1]))throw Error('Invalid or duplicate inventory connection field')
  fields[m[1]]=m[2]??m[3]??m[4]
 }
 const host=fields.ansible_host,port=Number(fields.ansible_port),user=fields.ansible_user
 let key=fields.ansible_ssh_private_key_file
 if(!isIP(host??'')||!Number.isInteger(port)||port<1||port>65535||user!=='ansible'||!key)throw Error('Unsupported inventory connection')
 if(key.startsWith('~/'))key=resolve(home,key.slice(2))
 if(!key.startsWith('/')||/[\x00-\x1f\x7f]/.test(key))throw Error('Invalid controller identity path')
 return {host,port,user,key}
}
export function publicIdentity(bundle){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(bundle.requestId??'')||bundle.requestedOwnerEmail!=='r@honeycluster.io')throw Error('Unexpected public enrollment request')
 const match=bundle.publicKey?.match(/^ssh-ed25519 ([A-Za-z0-9+/]+={0,2})(?: [^\r\n\x00]+)?$/)
 if(!match)throw Error('Expected an Ed25519 public key')
 const data=Buffer.from(match[1],'base64')
 if(data.length!==51||data.readUInt32BE(0)!==11||data.subarray(4,15).toString()!=='ssh-ed25519'||data.readUInt32BE(15)!==32||data.toString('base64')!==match[1])throw Error('Invalid public key encoding')
 const fingerprint='SHA256:'+createHash('sha256').update(data).digest('base64').replace(/=+$/,'')
 if(fingerprint!==bundle.fingerprint)throw Error('Public key fingerprint mismatch')
 return {id:bundle.requestId,blob:match[1],fingerprint}
}
export function expiry(value,now=Date.now()){
 const time=Date.parse(value)
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value??'')||!Number.isFinite(time)||time<=now||time>now+24*60*60*1000||new Date(time).toISOString().replace('.000Z','Z')!==value)throw Error('Expiry must be a UTC timestamp within the next 24 hours')
 return value.replace(/[-:]/g,'').replace('T','')
}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
export function sshArgs(c,knownHosts,command){
 if(/[\x00-\x1f\x7f]/.test(knownHosts))throw Error('Invalid trust store path')
 const trust='UserKnownHostsFile="'+knownHosts.replace(/[\\"]/g,'\\$&')+'"'
 return ['-F','/dev/null','-i',c.key,'-p',String(c.port),'-l',c.user,...[
  'BatchMode=yes','IdentitiesOnly=yes','StrictHostKeyChecking=yes',trust,
  'GlobalKnownHostsFile=/dev/null','UpdateHostKeys=no','VerifyHostKeyDNS=no',
  'ForwardAgent=no','ForwardX11=no','ClearAllForwardings=yes','RequestTTY=no',
  'ControlMaster=no','ControlPath=none','ControlPersist=no','PermitLocalCommand=no',
  'PasswordAuthentication=no','KbdInteractiveAuthentication=no','PreferredAuthentications=publickey',
  'ConnectTimeout=10','ConnectionAttempts=1','ServerAliveInterval=10','ServerAliveCountMax=2',
 ].flatMap(option=>['-o',option]),'--',c.host,command]
}
// Runs as the EXISTING ansible account. No new users, sudoers edits, sshd changes,
// private-key transfer, service restart, or application/database deployment.
export const remoteProgram=`set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077
mode=$1; request=$2; blob=$3; expires=$4
[ "$(id -un)" = ansible ] || exit 61
[ "$(sudo -n id -u)" = 0 ] || exit 62
home=$(getent passwd ansible | cut -d: -f6)
case "$home" in /*) ;; *) exit 63;; esac
sshdir="$home/.ssh"; auth="$sshdir/authorized_keys"
[ -d "$sshdir" ] && [ ! -L "$sshdir" ] && [ -f "$auth" ] && [ ! -L "$auth" ] || exit 64
state=absent
if grep -F -- "$blob" "$auth" >/dev/null; then state=present; fi
if [ "$mode" = apply ]; then
  [ -w "$auth" ] || exit 65
  [ ! -L "$sshdir/.rue-operator.lock" ] || exit 66
  exec 9>>"$sshdir/.rue-operator.lock"
  flock -n 9 || exit 67
  now=$(date -u +%Y%m%d%H%M%S)
  until_value=\${expires%Z}
  [ "$until_value" -gt "$now" ] || exit 68
  line="restrict,expiry-time=\\"$expires\\" ssh-ed25519 $blob rue-infrastructure-$request"
  if grep -F -- "$blob" "$auth" >/dev/null; then
    [ "$(grep -F -c -- "$blob" "$auth")" = 1 ] && grep -F -x -- "$line" "$auth" >/dev/null || exit 69
    state=already-installed
  else
    backups="$sshdir/rue-operator-backups"
    [ ! -L "$backups" ] || exit 70
    mkdir -p "$backups"; chmod 700 "$backups"
    backup="$backups/$request.authorized_keys.before"
    if [ ! -e "$backup" ]; then (set -C; cat "$auth" > "$backup"); fi
    printf '\\n%s\\n' "$line" >> "$auth"
    grep -F -x -- "$line" "$auth" >/dev/null || exit 71
    state=installed
  fi
fi
printf 'RUE_OPERATOR_V1\\n%s\\nansible\\n0\\n%s\\n' "$(hostname -s)" "$state"
`

async function run(binary,args,input=''){
 return await new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{stdio:['pipe','pipe','pipe'],shell:false})
  const chunks=[];let length=0,failed=false
  const fail=()=>{if(failed)return;failed=true;clearTimeout(timer);child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1000).unref();reject(Error('Operator command failed or timed out; reconcile before repeating an apply'))}
  const timer=setTimeout(fail,45000)
  child.stdout.on('data',chunk=>{length+=chunk.length;if(length>65536)fail();else chunks.push(chunk)})
  // Never echo SSH banners or arbitrary remote error output to shared logs.
  child.stderr.on('data',chunk=>{length+=chunk.length;if(length>65536)fail()})
  child.on('error',fail)
  child.on('close',code=>{clearTimeout(timer);if(!failed){if(code!==0)fail();else resolve(Buffer.concat(chunks).toString('utf8'))}})
  child.stdin.on('error',()=>{})
  child.stdin.end(input)
 })
}
export async function main(args=process.argv.slice(2)){
 const {values:v}=parseArgs({args,options:{'provision-dir':{type:'string'},'public-bundle':{type:'string'},'known-hosts':{type:'string'},'expires-at':{type:'string'},'expected-fingerprint':{type:'string'},apply:{type:'boolean'},'acknowledge-host-admin':{type:'boolean'}}})
 if(!v['provision-dir']||!v['public-bundle'])throw Error('Required: --provision-dir and --public-bundle; default mode is read-only')
 if(v.apply&&(!v['acknowledge-host-admin']||!v['expires-at']||!v['expected-fingerprint']))throw Error('Apply requires --acknowledge-host-admin, --expires-at and --expected-fingerprint')
 const identity=publicIdentity(JSON.parse(await readFile(resolve(v['public-bundle']),'utf8')))
 if(v['expected-fingerprint']&&v['expected-fingerprint']!==identity.fingerprint)throw Error('Independently approved public key fingerprint does not match')
 const until=v['expires-at']?expiry(v['expires-at']):''
 const knownHosts=resolve(v['known-hosts']??resolve(homedir(),'.ssh/known_hosts'))
 const configurations=[]
 for(const [name,file] of Object.entries(targets)){
  const c=connection(await readFile(resolve(v['provision-dir'],'inventory/host_vars',file),'utf8'))
  const key=await stat(c.key).catch(()=>{throw new ControllerAccessError('Controller SSH identity is unavailable; run this command on Mason with its existing identity')})
  if(!key.isFile()||(key.mode&0o077)!==0)throw Error('Controller SSH identity must be a private file')
  configurations.push({name,...c})
 }
 if(!(await stat(knownHosts)).isFile())throw Error('Verified controller known_hosts file required')
 // Preflight BOTH hosts before authorizing either one. No blanket fleet playbook.
 const report={requestId:identity.id,fingerprint:identity.fingerprint,expiresAt:v['expires-at']??null,mode:v.apply?'apply':'check',botCreated:false,newIdentityLoginVerified:false,hosts:[]}
 for(const c of configurations){
  const command='/bin/sh -s -- '+['check',identity.id,identity.blob,until].map(quote).join(' ')
  const result=await run('/usr/bin/ssh',sshArgs(c,knownHosts,command),remoteProgram)
  const lines=result.trim().split(/\r?\n/)
  if(lines.length!==5||lines[0]!=='RUE_OPERATOR_V1'||!/^[A-Za-z0-9_.-]+$/.test(lines[1])||lines[2]!=='ansible'||lines[3]!=='0'||!['absent','present'].includes(lines[4]))throw Error('Unexpected SSH preflight response')
  const lookup=c.port===22?c.host:`[${c.host}]:${c.port}`
  const pins=(await run('/usr/bin/ssh-keygen',['-F',lookup,'-f',knownHosts])).split(/\r?\n/).filter(line=>line&&!line.startsWith('#'))
  if(!pins.length)throw Error('No target-specific verified host pins found')
  report.hosts.push({name:c.name,host:c.host,port:c.port,user:c.user,hostname:lines[1],knownHosts:pins,status:lines[4]})
 }
 const output=resolve(dirname(fileURLToPath(import.meta.url)),'../../.sandblocks/recovery',`infrastructure-operator-${identity.id}-${Date.now()}.json`)
 await mkdir(dirname(output),{recursive:true,mode:0o700})
 const save=()=>writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600})
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'})
 if(v.apply){
  for(const [index,c] of configurations.entries()){
   report.hosts[index].status='applying';await save()
   try{
    const command='/bin/sh -s -- '+['apply',identity.id,identity.blob,until].map(quote).join(' ')
    const result=await run('/usr/bin/ssh',sshArgs(c,knownHosts,command),remoteProgram)
    const lines=result.trim().split(/\r?\n/)
    if(lines.length!==5||lines[0]!=='RUE_OPERATOR_V1'||lines[1]!==report.hosts[index].hostname||lines[2]!=='ansible'||lines[3]!=='0'||!['installed','already-installed'].includes(lines[4]))throw Error('Unexpected enrollment response')
    report.hosts[index].status=lines[4];await save()
   }catch(error){report.hosts[index].status='needs-reconciliation';await save();throw error}
  }
 }
 console.log(JSON.stringify({mode:report.mode,report:output,hosts:report.hosts.map(({name,status})=>({name,status})),botCreated:false}))
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error instanceof ControllerAccessError?error.message:'Operator bootstrap did not complete. Check arguments, Mason identity/trust availability and any private reconciliation report. No automatic retry was attempted.');process.exitCode=1})
