import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const runtimeRepository='ghcr.io/multiterm/rue-agent-runtime'
const digest=/^sha256:[a-f0-9]{64}$/
/** Registry manifest digests and local Docker image IDs are different identities.
 * Preserve both: pull the immutable reference, then verify the local image ID.
 * Only publish the pinned, tested SDK, never npm's untested latest tag. */
export function runtimeReleaseManifest({revision,piVersion,images}){
 if(!/^[a-f0-9]{40}$/.test(revision??'')||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(piVersion??''))throw Error('Invalid runtime release identity')
 if(!Array.isArray(images)||images.length!==2)throw Error('Both runtime architectures are required')
 const releases=images.map(image=>{
  const labels=image?.Config?.Labels
  if(!Number.isSafeInteger(image?.Size)||image.Size<=0||image.Size>4*1024**3||image?.Os!=='linux'||!['amd64','arm64'].includes(image.Architecture)||!digest.test(image.Id??''))throw Error('Invalid runtime platform or image ID')
  if(labels?.['io.rue.source-revision']!==revision||labels?.['io.rue.pi-sdk']!==piVersion||labels?.['io.rue.agent-runtime']!=='1'||labels?.['io.rue.filesystem']!=='3'||['io.rue.mcp-tools','io.rue.compact','io.rue.codex-oauth'].some(key=>labels?.[key]!=='1'))throw Error('Runtime labels do not match the tested release')
  const references=[...new Set((image.RepoDigests??[]).filter(ref=>typeof ref==='string'&&ref.startsWith(runtimeRepository+'@')&&digest.test(ref.slice(runtimeRepository.length+1))))]
  if(references.length!==1)throw Error('An unambiguous published GHCR digest is required')
  return {platform:`linux/${image.Architecture}`,reference:references[0],image:image.Id,piVersion,sizeBytes:image.Size}
 }).sort((a,b)=>a.platform.localeCompare(b.platform))
 if(new Set(releases.map(r=>r.platform)).size!==2)throw Error('Duplicate runtime architecture')
 return {version:1,channel:'development',source:{repository:'https://github.com/multiterm/rue',revision},piVersion,releases}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [revision,manifestPath,amd64Path,arm64Path,output,...extra]=process.argv.slice(2)
 if(!output||extra.length)throw Error('Usage: runtime-release-manifest.mjs <revision> <runtime-package.json> <amd64-inspect.json> <arm64-inspect.json> <output.json>')
 const manifest=JSON.parse(await readFile(manifestPath,'utf8')),piVersion=manifest.dependencies?.['@earendil-works/pi-coding-agent']
 if(piVersion!==manifest.dependencies?.['@earendil-works/pi-ai'])throw Error('Runtime Pi dependencies must share one pinned version')
 const images=await Promise.all([amd64Path,arm64Path].map(async path=>JSON.parse(await readFile(path,'utf8'))))
 await writeFile(output,JSON.stringify(runtimeReleaseManifest({revision,piVersion,images}),null,2)+'\n',{flag:'wx'})
}
