import type {RueRemoteComputer,RueProviderKeys} from '@multiterm/rue-sdk'

export function hasAgentCredentialGrant(owner:string,provider:string,connectionId:string,keys:RueProviderKeys){
 if(keys.ownerSubject!==owner||!keys.keyStorageAvailable)return false
 if(provider==='openai-codex'){
  const oauth=keys.oauth
  return Boolean(oauth?.ownerSubject===owner&&oauth.configured&&oauth.keyStorageAvailable&&oauth.runtimeSupported&&oauth.state==='ready'&&oauth.grants?.some(g=>g.type==='terminal'&&g.id===connectionId))
 }
 return Boolean(keys.keys.some(k=>k.provider===provider&&k.configured&&k.grants.some(g=>g.type==='terminal'&&g.id===connectionId)))
}
export function sidebarAgentActivity(computer:RueRemoteComputer|undefined,fresh:boolean,remote:boolean,sending:boolean,healthError:boolean):'Working'|'Compacting'|undefined{
 if(!remote)return sending?'Working':undefined
 if(!fresh||healthError)return
 const state=computer?.health?.status?.state
 if(state==='compacting')return 'Compacting'
 if(state==='working'||computer?.health?.agentWorking)return 'Working'
 // A running command is useful for older runtimes without activity telemetry.
 if(state==null&&computer?.health?.agentWorking==null&&computer?.runs.some(run=>run.status==='running'))return 'Working'
}
