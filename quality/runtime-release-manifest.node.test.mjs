import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runtimeReleaseManifest,runtimeRepository} from '../scripts/deployment/runtime-release-manifest.mjs'
const revision='a'.repeat(40),piVersion='0.85.1'
const image=architecture=>({Id:'sha256:'+('amd64'===architecture?'b':'c').repeat(64),Os:'linux',Size:1024,Architecture:architecture,RepoDigests:[runtimeRepository+'@sha256:'+('amd64'===architecture?'d':'e').repeat(64)],Config:{Labels:{'io.rue.agent-runtime':'1','io.rue.pi-sdk':piVersion,'io.rue.source-revision':revision,'io.rue.filesystem':'3','io.rue.mcp-tools':'1','io.rue.compact':'1','io.rue.codex-oauth':'1'}}})
const input=()=>({revision,piVersion,images:[image('amd64'),image('arm64')]})
test('publishes distinct pull references and local image identities for both architectures',()=>{
 const result=runtimeReleaseManifest(input())
 assert.equal(result.channel,'development')
 assert.deepEqual(result.releases.map(r=>r.platform),['linux/amd64','linux/arm64'])
 assert.equal(result.releases[0].image,'sha256:'+'b'.repeat(64))
 assert.equal(result.releases[0].reference,runtimeRepository+'@sha256:'+'d'.repeat(64))
 assert.equal(JSON.stringify(result).includes('Config'),false)
})
test('rejects untested versions, missing safeguards, and another source revision',()=>{
 for(const [key,value]of [['io.rue.pi-sdk','1.1.0'],['io.rue.source-revision','f'.repeat(40)],['io.rue.filesystem','2'],['io.rue.compact','0'],['io.rue.mcp-tools','0'],['io.rue.codex-oauth','0'],['io.rue.agent-runtime','0']]){
  const candidate=input();candidate.images[0].Config.Labels[key]=value
  assert.throws(()=>runtimeReleaseManifest(candidate),/labels/)
 }
})
test('rejects tags, other repositories, and ambiguous or missing registry digests',()=>{
 for(const references of [[],[runtimeRepository+':latest'],['ghcr.io/other/runtime@sha256:'+'d'.repeat(64)],[runtimeRepository+'@sha256:'+'d'.repeat(64),runtimeRepository+'@sha256:'+'f'.repeat(64)]]){
  const candidate=input();candidate.images[0].RepoDigests=references
  assert.throws(()=>runtimeReleaseManifest(candidate),/digest/)
 }
})
test('requires complete, unique Linux native architectures and immutable image IDs',()=>{
 for(const mutate of [c=>c.images.pop(),c=>c.images[1]=image('amd64'),c=>c.images[0].Os='windows',c=>c.images[0].Id='latest',c=>c.images[0].Architecture='x64']){
  const candidate=input();mutate(candidate);assert.throws(()=>runtimeReleaseManifest(candidate))
 }
})
test('rejects shell syntax, ranges, branch names and prerelease selectors',()=>{
 for(const piVersion of ['latest','^0.85.1','1.1.0;echo injected','1.1.0-beta'])assert.throws(()=>runtimeReleaseManifest({...input(),piVersion}))
 assert.throws(()=>runtimeReleaseManifest({...input(),revision:'develop'}))
})
