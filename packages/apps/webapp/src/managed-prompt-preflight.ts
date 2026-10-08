import type {RueManagedAgent,RueProviderKeys,RueSession} from '@multiterm/rue-sdk'
import {managedRuntimeProblem} from './agent-setup-help.js'

export class ManagedPromptSetupError extends Error {
 constructor(readonly code:string,message:string){super(message);this.name='ManagedPromptSetupError'}
}
/** Metadata-only UX check. The runtime broker still authorizes each credential use;
 * this must never create a grant, retrieve a secret, or replay an accepted task. */
export async function checkManagedPromptCredentials(client:{managedAgents():Promise<{agents:RueManagedAgent[]}>;providerKeys():Promise<RueProviderKeys>},session:RueSession,owner:string,current:()=>boolean){
 if(!session.meta.managedAgentId)return
 if(session.ownerSubject!==owner||!current())throw Error('Account or bot changed. Reopen the bot before sending.')
 let agents:RueManagedAgent[],keys:RueProviderKeys
 try{const result=await Promise.all([client.managedAgents(),client.providerKeys()]);agents=result[0].agents;keys=result[1]}
 catch{throw new ManagedPromptSetupError('check_failed','Could not verify this bot’s AI-key setup. No request was sent. Check the connection and try again.')}
 if(!current()||keys.ownerSubject!==owner)throw Error('Account or bot changed. Reopen the bot before sending.')
 const connection=session.terminalConnectionId??session.meta.terminalConnectionId
 const agent=agents.find(a=>a.id===session.meta.managedAgentId&&a.sessionId===session.id&&(a.connectionId??null)===(connection??null))
 if(!agent)throw new ManagedPromptSetupError('not_ready','This managed bot is not ready. Refresh its status before sending.')
 const runtimeProblem=managedRuntimeProblem(agent)
 if(runtimeProblem)throw new ManagedPromptSetupError(runtimeProblem,'The managed runtime reported an error. Review agent status before sending.')
 if(agent.desired!=='running')throw new ManagedPromptSetupError(agent.desired,'This managed bot is not ready. Refresh its status before sending.')
 if(!agent.connectionId||agent.observed==='pending'||agent.observed==='starting')throw new ManagedPromptSetupError('not_ready','This managed bot is still starting. Wait for it to become ready before sending.')
 if(!keys.keyStorageAvailable)throw new ManagedPromptSetupError('storage_unavailable','Secure credential storage is unavailable. No request was sent.')
 const provider=agent.config.provider
 if(provider==='openai-codex'){
  const oauth=keys.oauth
  if(!oauth||oauth.ownerSubject!==owner||!oauth.configured||!oauth.keyStorageAvailable||!oauth.runtimeSupported||oauth.state!=='ready')throw new ManagedPromptSetupError(oauth?.state==='refreshing'?'oauth_refreshing':oauth&&!oauth.runtimeSupported?'oauth_runtime':oauth?.state==='reauthorize'?'oauth_reauthorize':'oauth_missing','Open AI keys and connect or reconnect OpenAI Codex OAuth before sending. An OpenAI API key is not a Codex OAuth grant.')
  if(!oauth.grants?.some(g=>g.type==='terminal'&&g.id===agent.connectionId))throw new ManagedPromptSetupError('grant_missing','Open AI keys and explicitly grant this bot access to OpenAI Codex OAuth before sending.')
 }else{
  const key=keys.keys.find(k=>k.provider===provider)
  if(!key?.configured)throw new ManagedPromptSetupError('key_missing',`Open AI keys and configure a saved credential for ${provider} before sending.`)
  if(!key.grants.some(g=>g.type==='terminal'&&g.id===agent.connectionId))throw new ManagedPromptSetupError('grant_missing',`Open AI keys and explicitly grant this bot access to ${provider} before sending. Saving a key alone does not grant access to new bots.`)
 }
}
