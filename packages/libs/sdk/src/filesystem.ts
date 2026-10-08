/** Explicit directory grants; host sharing is a separate operator decision. */
export const workspaceRoot='/Volumes/MOTHERSHIP'
export const protectedWorkspaceRoot=workspaceRoot+'/.rue-colima-cache'
export interface DirectoryGrant {path:string;access:'read'|'write'}
export interface FilesystemPolicy {version:1;directories:DirectoryGrant[]}
export const beneathDirectory=(path:string,parent:string)=>path===parent||path.startsWith(parent+'/')
const foldedPath=(path:string)=>path.replace(/[A-Z]/g,char=>char.toLowerCase())
const reserved=['/app','/control','/state','/workspace','/bin','/sbin','/usr','/lib','/lib64','/etc','/proc','/sys','/dev','/run','/tmp','/var/run','/var/lib/docker','/var/lib/containerd','/var/lib/rue-worker']
/** Keep in sync with the independent native mount verifier. */
export function validHostDirectory(path:unknown):path is string{
 if(typeof path!=='string'||new TextEncoder().encode(path).byteLength>1024||!path.startsWith('/')||/[\x00-\x1f\x7f]/.test(path)||path.split('/').slice(1).some(p=>!p||p==='.'||p==='..'))return false
 const folded=foldedPath(path)
 if(reserved.some(p=>beneathDirectory(folded,p)||beneathDirectory(p,folded)))return false
 if(['/users','/home','/root','/volumes'].includes(folded)||/^\/(users|home)\/[^/]+$/.test(folded))return false
 const parts=folded.split('/')
 if(parts.some(p=>['.colima','.docker','.rue-colima-cache'].includes(p)))return false
 if(/\/\.local(?:\/state(?:\/rue(?:\/.*)?)?)?$/.test(folded)||/\/library(?:\/caches(?:\/colima(?:\/.*)?)?)?$/.test(folded))return false
 return true
}
export function validFilesystemPolicy(value:unknown):value is FilesystemPolicy{
 if(!value||typeof value!=='object'||Array.isArray(value))return false
 const p=value as Record<string,unknown>
 if(new TextEncoder().encode(JSON.stringify(value)).byteLength>2048)return false
 if(Object.keys(p).some(k=>!['version','directories'].includes(k))||p.version!==1||!Array.isArray(p.directories)||p.directories.length>8)return false
 const grants:DirectoryGrant[]=[]
 for(const entry of p.directories){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))return false
  const e=entry as Record<string,unknown>
  if(Object.keys(e).some(k=>!['path','access'].includes(k))||!validHostDirectory(e.path)||(e.access!=='read'&&e.access!=='write'))return false
  if(grants.some(g=>foldedPath(g.path)===foldedPath(e.path as string)))return false
  grants.push({path:e.path,access:e.access})
 }
 return !grants.some(child=>child.access==='read'&&grants.some(parent=>parent.access==='write'&&foldedPath(child.path).startsWith(foldedPath(parent.path)+'/')))
}
/** Operator roots are disjoint. A bot cannot add to or widen this list. */
export function validWorkspaceRoots(value:unknown):value is string[]{
 return Array.isArray(value)&&value.length<=8&&new TextEncoder().encode(JSON.stringify(value)).byteLength<=2048&&value.every(validHostDirectory)&&!value.some((a,i)=>value.some((b,j)=>i!==j&&beneathDirectory(foldedPath(a),foldedPath(b))))
}
export function requiresWorkspaceRoots(policy:FilesystemPolicy){return policy.directories.some(g=>!beneathDirectory(g.path,workspaceRoot))}
