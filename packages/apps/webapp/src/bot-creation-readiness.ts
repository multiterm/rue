import type {RueManagedAgentConfig,RueProviderKeys,RueWorker} from '@multiterm/rue-sdk'
export function botCreationReadiness(owner:string,config:RueManagedAgentConfig,host:RueWorker|undefined,keys:RueProviderKeys|undefined,modelListed:boolean){
 const hostReady=Boolean(host&&host.ownerSubject===owner&&host.status==='online'&&host.desired==='active'&&host.health?.dockerAvailable&&host.health.capabilities.includes('managed-agents-v1'))
 const supported=config.provider!=='openai-codex'||host?.health?.capabilities.includes('managed-codex-v1')===true
 const storage=keys?.ownerSubject===owner&&keys.keyStorageAvailable===true
 const credential=Boolean(storage&&(config.provider==='openai-codex'?keys?.oauth?.ownerSubject===owner&&keys.oauth.configured&&keys.oauth.keyStorageAvailable&&keys.oauth.runtimeSupported&&keys.oauth.state==='ready':keys?.keys.some(k=>k.provider===config.provider&&k.configured)))
 return {canCreate:hostReady&&supported&&modelListed&&credential,rows:[
  ['Host',hostReady?(host?.health?.acceptingWork?'Available':'Available · new agent will wait for capacity'):'Select an available managed host'],
  ['Model',modelListed&&supported?'Listed in the catalog · installed runtime support is checked after startup':'Select a supported provider and model'],
  ['Credential',credential?'Saved credential available':storage?'Configure this provider in Settings → AI keys first':'Secure credential availability could not be verified'],
  ['Agent grant','Required after creation · explicitly allow this new bot in AI keys'],
 ] as Array<[string,string]>}
}
