import {validWorkspaceRoots} from '../../packages/libs/sdk/src/filesystem.ts'
import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const context = 'colima-rue', volume = 'rue-mason-worker-private', image = 'rue-worker:mason'
const root = '/Volumes/MOTHERSHIP'
export function beneath(path, parent) {
  const rel = relative(parent, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'))
}
export function approvedShares(workspaceRoots=[]) {
  const shares=[...new Set([root,...workspaceRoots])]
  if(!validWorkspaceRoots(workspaceRoots)||!validWorkspaceRoots(shares))throw Error('mason_workspace_roots_invalid')
  return shares
}
export function loadWorkspaceRoots(file=resolve(homedir(),'.local/state/rue/workspace-roots.json'),required=false){
  let fd
  try{fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW)}catch(error){if(!required&&error.code==='ENOENT')return undefined;throw Error('mason_workspace_roots_invalid')}
  try{
    const st=fstatSync(fd)
    if(!st.isFile()||st.uid!==process.getuid?.()||st.nlink!==1||(st.mode&0o077)||st.size>2048)throw Error('mason_workspace_roots_invalid')
    const roots=JSON.parse(readFileSync(fd,'utf8')),shares=approvedShares(roots),canonical=realpathSync(file),current=statSync(canonical)
    if(st.dev!==current.dev||st.ino!==current.ino)throw Error('mason_workspace_roots_invalid')
    if(shares.some(share=>beneath(canonical,share)||beneath(`${homedir()}/.colima`,share)))throw Error('mason_workspace_roots_invalid')
    return roots
  }finally{closeSync(fd)}
}
export function enrollment(secretFile, origin, id, workspaceRoot = root, workspaceRoots=[]) {
  const fd = openSync(secretFile, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const st = fstatSync(fd), canonical = realpathSync(secretFile), current = statSync(canonical)
    if (!st.isFile() || st.uid !== process.getuid?.() || st.nlink !== 1 || (st.mode & 0o077) || st.size > 1024 ||
      st.dev !== current.dev || st.ino !== current.ino || [workspaceRoot,...workspaceRoots].some(source=>beneath(canonical,realpathSync(source))) || beneath(canonical, `${homedir()}/Library/Caches/colima`)) throw Error('mason_credential_file_not_private')
    const secret = readFileSync(fd, 'utf8').trim(), url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin || id?.length !== 36 || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || !/^rue_worker_[A-Za-z0-9_-]{43}$/.test(secret)) throw Error('mason_enrollment_invalid')
    return JSON.stringify({ origin, id, secret }) + '\n'
  } finally { closeSync(fd) }
}
export function verifyMounts(filesystems,workspaceRoots=[]) {
  const shares=approvedShares(workspaceRoots)
  if (!Array.isArray(filesystems) || filesystems.length !== shares.length || new Set(filesystems.map(f=>f.target)).size!==shares.length || filesystems.some(f=>!shares.includes(f.target)||f.children?.length)) throw Error('mason_unapproved_host_mount')
}
const env = { ...process.env, DOCKER_CONTEXT: context, COLIMA_HOME: `${homedir()}/.colima`, XDG_CACHE_HOME: `${root}/.rue-colima-cache` }
for (const name of ['DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[name]
function run(command, args, input) {
  const result = spawnSync(command, args, { env, input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) throw Error('mason_command_failed')
  return result.stdout.trim()
}
function docker(args, input) { return run('docker', ['--context', context, ...args], input) }
export function verifyMason(workspaceRoots=[]) {
  if (process.platform !== 'darwin') throw Error('mason_macos_required')
  if (docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']) !== `unix://${homedir()}/.colima/rue/docker.sock` ||
    docker(['info', '--format', '{{.Name}}']) !== 'colima-rue') throw Error('mason_docker_context_mismatch')
  if (docker(['info', '--format', '{{.ID}}']) !== run('colima', ['--profile', 'rue', 'ssh', '--', 'sudo', 'docker', '--host', 'unix:///var/run/docker.sock', 'info', '--format', '{{.ID}}'])) throw Error('mason_engine_mismatch')
  const mounts = JSON.parse(run('colima', ['--profile', 'rue', 'ssh', '--', 'findmnt', '-J', '-t', 'virtiofs,9p,fuse.sshfs,nfs,nfs4,cifs', '-o', 'TARGET,OPTIONS']))
  verifyMounts(mounts.filesystems,workspaceRoots)
  run('colima', ['--profile', 'rue', 'ssh', '--', 'sh', '-c', 'test -z "$SSH_AUTH_SOCK"'])
  // Mount labels alone cannot prove the host source. Fresh non-secret markers
  // establish that the running VM sees these exact directories, not a stale
  // configuration which maps a different host directory to the same target.
  for (const source of approvedShares(workspaceRoots)) {
    if (realpathSync(source) !== source) throw Error('mason_mount_source_symlink')
    const directory = mkdtempSync(`${source}/.rue-boundary-`), marker = `${directory}/nonce`, nonce = randomBytes(32).toString('hex')
    try {
      writeFileSync(marker, nonce, { mode: 0o644, flag: 'wx' })
      if (run('colima', ['--profile', 'rue', 'ssh', '--', 'cat', marker]) !== nonce) throw Error('mason_mount_source_mismatch')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }
}
export function verifyVolumeMetadata(info) {
  if (info?.Name !== volume || info.Driver !== 'local' || info.Scope !== 'local' || info.Labels?.['dev.rue.role'] !== 'worker-private' ||
    typeof info.Mountpoint !== 'string' || !info.Mountpoint.startsWith('/') ||
    (info.Options != null && (typeof info.Options !== 'object' || Array.isArray(info.Options) || Object.keys(info.Options).length))) throw Error('mason_private_volume_mismatch')
}
export function verifyPrivateVolume(workspaceRoots=[]) {
  const info = JSON.parse(docker(['volume', 'inspect', volume, '--format', '{{json .}}']))
  verifyVolumeMetadata(info)
  const canonical = path => run('colima', ['--profile', 'rue', 'ssh', '--', 'sudo', 'readlink', '-f', '--', path])
  const data = canonical(docker(['info', '--format', '{{.DockerRootDir}}'])), mount = canonical(info.Mountpoint)
  if (approvedShares(workspaceRoots).some(share=>beneath(data,share)) || mount !== `${data}/volumes/${volume}/_data`) throw Error('mason_private_volume_exposed')
}
function main() {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, enroll: { type: 'boolean' }, start: { type: 'boolean' }, 'configure-runtime': { type: 'boolean' }, 'agent-image': { type: 'string' }, 'agent-limit': {type:'string'}, 'allow-runtime-rollouts': {type:'boolean'}, 'disable-runtime-rollouts': {type:'boolean'}, mothership: { type: 'boolean' },
    'workspace-roots-file': {type:'string'}, 'secret-file': { type: 'string' }, 'api-origin': { type: 'string' }, 'worker-id': { type: 'string' } }, strict: true })
  if ([values.check, values.enroll, values.start, values['configure-runtime']].filter(Boolean).length !== 1) throw Error('mason_action_required')
  if((values.mothership||values['agent-limit']||values['allow-runtime-rollouts']||values['disable-runtime-rollouts'])&&!values['configure-runtime'])throw Error('mason_action_required')
  if(values['allow-runtime-rollouts']&&values['disable-runtime-rollouts'])throw Error('mason_action_required')
  const configuredRoots=loadWorkspaceRoots(values['workspace-roots-file'],Boolean(values['workspace-roots-file'])),workspaceRoots=configuredRoots??[]
  verifyMason(workspaceRoots)
  if (values.enroll) {
    const input = enrollment(values['secret-file'], values['api-origin'], values['worker-id'],root,workspaceRoots)
    docker(['volume', 'create', '--label', 'dev.rue.role=worker-private', volume])
    verifyPrivateVolume(workspaceRoots)
    // No host credential bind, secret argv/env, network, or overwrite of existing enrollment.
    docker(['run', '--pull=never', '--rm', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--memory', '64m', '--cpus', '0.25', '--pids-limit', '32', '--mount', `type=volume,src=${volume},dst=/state`,
      '--entrypoint', '/bin/sh', image, '-c', 'umask 077; chmod 700 /state; test ! -e /state/link.json || exit 73; set -C; cat > /state/link.json'], input)
    console.log('Enrollment saved in the private VM volume. No credential was printed.')
  } else if (values['configure-runtime']) {
    verifyPrivateVolume(workspaceRoots)
    const previous=JSON.parse(docker(['run','--rm','--pull=never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--cpus','0.5','--pids-limit','32','--mount',`type=volume,src=${volume},dst=/var/lib/rue-worker,readonly`,'--entrypoint','/usr/local/bin/rue-worker',image,'runtime-policy']))
    const runtime=values['agent-image']??previous.image
    if (typeof runtime !== 'string' || runtime.length !== 71 || !/^sha256:[a-f0-9]{64}$/.test(runtime)) throw Error('mason_runtime_image_invalid')
    const capacity=values['agent-limit']===undefined?previous.capacity:Number(values['agent-limit']),mothership=values.mothership??previous.mothership,rollouts=values['disable-runtime-rollouts']?false:values['allow-runtime-rollouts']??previous.allowRuntimeRollouts
    if(!Number.isSafeInteger(capacity)||capacity<1)throw Error('mason_agent_limit_invalid')
    // Intentionally do not stop a running daemon here. The kernel lock refuses
    // concurrent configuration; drain/stop agents and stop the supervisor first.
    docker(['run', '--rm', '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--memory', '512m', '--cpus', '1', '--pids-limit', '64', '--mount', `type=volume,src=${volume},dst=/var/lib/rue-worker`,
      '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock', '--env', `RUE_WORKER_AGENT_IMAGE=${runtime}`, '--env', `RUE_WORKER_MOTHERSHIP=${mothership?'true':'false'}`, '--env', `RUE_WORKER_AGENT_LIMIT=${capacity}`, '--env', `RUE_WORKER_ALLOW_RUNTIME_ROLLOUTS=${rollouts?'true':'false'}`, '--env',`RUE_WORKER_WORKSPACE_ROOTS=${JSON.stringify(configuredRoots??previous.workspaceRoots??[])}`, image, 'configure-runtime'])
    console.log('Pinned runtime policy saved. No agent or supervisor was started.')
  } else if (values.start) {
    verifyPrivateVolume(workspaceRoots)
    run('docker-compose', ['-f', fileURLToPath(new URL('../../deploy/worker/mason.compose.yaml', import.meta.url)), 'up', '-d'])
    console.log('Worker Compose started. Check Rue for authenticated status. Agent execution requires a pinned local runtime policy.')
  } else console.log('Mason boundary verified: colima-rue; only explicitly approved host roots are shared. No enrollment or start performed.')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch { console.error('Mason worker operation failed. Check the dedicated context, approved mounts, private credential file and enrollment state. Existing enrollment is never overwritten.'); process.exitCode = 1 }
}
