import {createCredentialCodec} from './credential-codec.js'
import {readCredentialKey} from './credential-key.js'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'

export const AgentSettingsSchema = z.object({
  harness: z.literal('pi'), provider: z.literal('openai'),
  model: z.string().trim().min(1).max(120), systemPrompt: z.string().max(16000),
}).strict()
export const AgentSettingsUpdateSchema = AgentSettingsSchema.extend({
  expectedOwnerSubject: z.string().min(1).max(512), expectedRevision: z.number().int().min(0), apiKey: z.string().trim().min(1).max(4096).nullable().optional(),
})
export const defaultAgentSettings = { harness: 'pi', provider: 'openai', model: 'gpt-4.1-mini', systemPrompt: 'You are a helpful assistant.' } as const
interface Row { settings: string; encrypted_key: string | null; revision: number }
import { AgentSettingsError } from '@multiterm/rue-db/postgres'
export { AgentSettingsError }
export function encryptionKey(db: Database): Buffer | undefined {
  return readCredentialKey(`${db.name}.agent-key`)
}
function row(db: Database, owner: string): Row | undefined {
  return db.prepare('SELECT settings, encrypted_key, revision FROM agent_settings WHERE owner_subject=?').get(owner) as Row | undefined
}
export function agentSettings(db: Database, owner: string) {
  const current = row(db, owner)
  const settings = current ? AgentSettingsSchema.parse(JSON.parse(current.settings)) : defaultAgentSettings
  return { ...settings, revision: current?.revision ?? 0, apiKeyConfigured: Boolean(current?.encrypted_key), keyStorageAvailable: Boolean(encryptionKey(db)) }
}
export function encryptCredential(db: Database, scope: string[], secret: string): string {
  return createCredentialCodec(()=>encryptionKey(db)).encrypt(scope,secret)
}
export function agentApiKey(db: Database, owner: string): string | undefined {
  const value = row(db, owner)?.encrypted_key
  if (!value) return undefined
  return decryptCredential(db, [owner, 'openai'], value)
}
export function decryptCredential(db: Database, scope: string[], value: string): string {
  return createCredentialCodec(()=>encryptionKey(db)).decrypt(scope,value)
}
export function saveAgentSettings(db: Database, owner: string, input: z.infer<typeof AgentSettingsUpdateSchema>) {
  return db.transaction(() => {
    const current = row(db, owner)
    if (input.expectedOwnerSubject !== owner || (current?.revision ?? 0) !== input.expectedRevision) throw new AgentSettingsError('agent_settings_conflict')
    const encrypted = input.apiKey === undefined ? current?.encrypted_key ?? null : input.apiKey === null ? null : encryptCredential(db, [owner, 'openai'], input.apiKey)
    const settings = AgentSettingsSchema.parse({ harness: input.harness, provider: input.provider, model: input.model, systemPrompt: input.systemPrompt })
    db.prepare('INSERT INTO agent_settings VALUES (?, ?, ?, ?) ON CONFLICT(owner_subject) DO UPDATE SET settings=excluded.settings, encrypted_key=excluded.encrypted_key, revision=excluded.revision')
      .run(owner, JSON.stringify(settings), encrypted, input.expectedRevision + 1)
    if (input.apiKey === null) db.prepare("DELETE FROM provider_key_grants WHERE owner_subject=? AND provider='openai'").run(owner)
    return agentSettings(db, owner)
  }).immediate()
}
