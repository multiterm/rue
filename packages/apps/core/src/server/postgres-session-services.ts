import {createPostgresConversationRepository,createPostgresHistoryRepository,createPostgresUsageRepository,createPostgresTerminalRelayRepository,createPostgresAgentSettingsRepository,recordPostgresTaskNotification,createPostgresPairingRepository,type RuePostgresDatabase} from '@multiterm/rue-db/postgres'
import {postgresRelayOptions} from '../storage/relay-health.js'
import {usageEventSchema} from '../storage/agent-usage.js'
import {AgentSettingsSchema,defaultAgentSettings} from '../storage/agent-settings.js'
import {createCredentialCodec} from '../storage/credential-codec.js'
import type {SessionServices} from './session-services.js'
import {createPostgresNotificationServices} from './notification-services.js'
import {createPostgresCredentialServices} from './credential-services.js'
import {createPostgresExecutionServices} from './execution-services.js'
import {createPostgresTerminalServices} from './terminal-services.js'
/** One database for every conversation path. This constructor does not select the
 * live backend; startup remains SQLite until all other API/socket domains migrate. */
export function createPostgresSessionServices(db:RuePostgresDatabase,encryptionKey:()=>Buffer|undefined):SessionServices {
 const relay=createPostgresTerminalRelayRepository(db,postgresRelayOptions)
 return {
  terminal:createPostgresTerminalServices(db,encryptionKey),
  execution:createPostgresExecutionServices(db,encryptionKey),
  credentials:createPostgresCredentialServices(db,encryptionKey),
  notifications:createPostgresNotificationServices(db,createCredentialCodec(encryptionKey)),
  pairing:createPostgresPairingRepository(db),
  async notifyCompletion(owner,id,key,kind){await db.transaction(tx=>recordPostgresTaskNotification(tx,owner,id,key,kind))},
  settings:createPostgresAgentSettingsRepository(db,{codec:createCredentialCodec(encryptionKey),keyStorageAvailable:()=>Boolean(encryptionKey()),defaults:defaultAgentSettings,parse:raw=>AgentSettingsSchema.parse(raw)}),
  conversations:createPostgresConversationRepository(db),
  history:createPostgresHistoryRepository(db),
  usage:createPostgresUsageRepository(db,{parseEvent:raw=>usageEventSchema.parse(raw),encryptionKey}),
  relay,
 }
}
