import type {Database} from 'better-sqlite3'
import {createRueDatabase,createSqliteSessionRepository} from '@multiterm/rue-db'
import {ConversationError,type createPostgresConversationRepository,type createPostgresHistoryRepository,type createPostgresUsageRepository,type createPostgresAgentSettingsRepository,type createPostgresTerminalRelayRepository,type createPostgresPairingRepository} from '@multiterm/rue-db/postgres'
import * as legacy from '../storage/index.js'
import {checkAttachmentBudget,appendContent} from '../storage/attachments.js'
import {agentUsage,recordAgentUsage,usageCredential,usageEventSchema} from '../storage/agent-usage.js'
import {agentSettings,agentApiKey,saveAgentSettings} from '../storage/agent-settings.js'
import {recordTaskNotification} from '../storage/notifications.js'
import {clearSessionHistory} from '../storage/history.js'
import {reconcileTerminalSession,enqueueTerminalPrompt} from '../storage/terminal-relay.js'
import type {ServerContext} from './context.js'
import {createSqlitePairingServices} from './sqlite-pairing-services.js'
import {createSqliteNotificationServices,type NotificationServices} from './notification-services.js'
import {createSqliteCredentialServices,type CredentialServices} from './credential-services.js'
import {createSqliteExecutionServices,type ExecutionServices} from './execution-services.js'
import {createSqliteTerminalServices,type TerminalServices} from './terminal-services.js'

export interface SessionServices {
 notifications:NotificationServices
 credentials:CredentialServices
 execution:ExecutionServices
 terminal:TerminalServices
 pairing:ReturnType<typeof createPostgresPairingRepository>
 settings:ReturnType<typeof createPostgresAgentSettingsRepository>
 notifyCompletion(owner:string,id:string,taskKey:string,kind:'task_completed'|'task_failed'):Promise<void>
 conversations:ReturnType<typeof createPostgresConversationRepository>
 history:Pick<ReturnType<typeof createPostgresHistoryRepository>,'clear'>
 usage:Pick<ReturnType<typeof createPostgresUsageRepository>,'report'|'credential'|'recordCloud'>
 relay:Pick<ReturnType<typeof createPostgresTerminalRelayRepository>,'enqueue'|'reconcileSession'>
}
/** Temporary adapter, always using the same single SQLite connection as the rest
 * of the legacy API. No PostgreSQL selection is exposed until all domains migrate. */
export function createSqliteSessionServices(db:Database):SessionServices {
 const page=createSqliteSessionRepository(createRueDatabase(db))
 const ownsMessage=(owner:string,id:string)=>{const m=legacy.getMessage(db,id);return m&&legacy.getSession(db,m.sessionId,owner)?m:undefined}
 const ownsPart=(owner:string,id:string)=>{const p=legacy.getPart(db,id);return p&&ownsMessage(owner,p.messageId)?.sessionId===p.sessionId?p:undefined}
 return {
  terminal:createSqliteTerminalServices(db),
  execution:createSqliteExecutionServices(db),
  credentials:createSqliteCredentialServices(db),
  notifications:createSqliteNotificationServices(db),
  pairing:createSqlitePairingServices(db),
  async notifyCompletion(owner,id,key,kind){db.transaction(()=>{if(!legacy.getSession(db,id,owner))throw new ConversationError(404,'session_not_found');recordTaskNotification(db,id,key,kind)}).immediate()},
  settings:{async get(owner){return agentSettings(db,owner)},async apiKey(owner){return agentApiKey(db,owner)},async save(owner,input){return saveAgentSettings(db,owner,input)}},
  conversations:{
   async snapshot(owner,id){return db.transaction(()=>legacy.getSession(db,id,owner)?{messages:legacy.listMessages(db,id),parts:legacy.listSessionParts(db,id)}:{messages:[],parts:[]})()},
   async list(owner,input){const result=await page.list(owner,input);return {...result,items:result.items.map(row=>({...row,terminalConnectionId:legacy.getSession(db,row.id,owner)?.terminalConnectionId??null}))}},
   async get(owner,id){return legacy.getSession(db,id,owner)},
   async create(owner,input){return legacy.createSession(db,{...input,ownerSubject:owner})},
   async update(owner,id,patch){return legacy.updateSession(db,id,patch,owner)},
   async delete(owner,id){return db.transaction(()=>{
    if(db.prepare("SELECT 1 FROM managed_agents WHERE session_id=? AND owner_subject=? AND desired!='destroyed'").get(id,owner))throw new ConversationError(409,'managed_agent_destroy_required')
    return legacy.deleteSession(db,id,owner)
   }).immediate()},
   async beginCloud(owner,input){return db.transaction(()=>{
    const session=legacy.getSession(db,input.sessionId,owner)
    if(!session)throw new ConversationError(404,'session_not_found')
    if(session.terminalConnectionId||session.agent==='pi-terminal'||session.meta.terminalConnectionId||db.prepare('SELECT 1 FROM managed_agents WHERE session_id=?').get(input.sessionId))throw new ConversationError(503,'terminal_transport_unavailable')
    checkAttachmentBudget(db,owner,input.content)
    const user=legacy.appendMessage(db,{id:input.userMessageId,sessionId:input.sessionId,role:'user'})
    if(input.content)appendContent(db,input.sessionId,user.id,input.content)
    else legacy.appendPart(db,{id:input.textPartId,sessionId:input.sessionId,messageId:user.id,type:'text',payload:{text:input.text}})
    const assistant=legacy.appendMessage(db,{id:input.assistantMessageId,sessionId:input.sessionId,role:'assistant',provider:input.provider,model:input.model})
    return {user,assistant}
   }).immediate()},
   async appendMessage(owner,input,content){return db.transaction(()=>{
    if(!legacy.getSession(db,input.sessionId,owner))throw new ConversationError(404,'session_not_found')
    checkAttachmentBudget(db,owner,content);const message=legacy.appendMessage(db,input)
    if(content)appendContent(db,input.sessionId,input.id,content)
    return message
   }).immediate()},
   async getMessage(owner,id){return ownsMessage(owner,id)},
   async listMessages(owner,id){return legacy.getSession(db,id,owner)?legacy.listMessages(db,id):[]},
   async appendPart(owner,input){return db.transaction(()=>{
    if(ownsMessage(owner,input.messageId)?.sessionId!==input.sessionId)throw new ConversationError(404,'message_not_found')
    return legacy.appendPart(db,{...input,type:input.type as legacy.PartType})
   }).immediate()},
   async updatePart(owner,id,payload){return db.transaction(()=>ownsPart(owner,id)?legacy.updatePart(db,id,payload):undefined).immediate()},
   async getPart(owner,id){return ownsPart(owner,id)},
   async listParts(owner,id){return ownsMessage(owner,id)?legacy.listParts(db,id):[]},
   async listSessionParts(owner,id){return legacy.getSession(db,id,owner)?legacy.listSessionParts(db,id):[]},
   async setRating(owner,id,rating){db.transaction(()=>{if(!ownsMessage(owner,id))throw new ConversationError(404,'message_not_found');legacy.setRating(db,id,rating)}).immediate()},
   async getRating(owner,id){return ownsMessage(owner,id)?legacy.getRating(db,id):0},
  },
  history:{async clear(owner,id,last){clearSessionHistory(db,id,owner,last);return {cleared:true as const}}},
  usage:{
   async report(owner,id,days,now){return agentUsage(db,owner,id,days,now)},
   async credential(owner,provider,key){return usageCredential(db,owner,provider,key)},
   async recordCloud(owner,id,raw,now){return recordAgentUsage(db,owner,id,`cloud:${id}`,usageEventSchema.parse(raw),now)},
  },
  relay:{
   async enqueue(owner,id,requestId,text,now,content){return enqueueTerminalPrompt(db,owner,id,requestId,text,now,content)},
   async reconcileSession(owner,id){if(legacy.getSession(db,id,owner))reconcileTerminalSession(db,id)},
  },
 }
}
export function sessionServices(ctx:ServerContext):SessionServices {
 if(ctx.sessions)return ctx.sessions
 if(!ctx.db||ctx.storage?.engine==='postgres')throw Error('rue_storage_not_initialized')
 return ctx.sessions=createSqliteSessionServices(ctx.db)
}
