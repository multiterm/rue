import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { openSync, closeSync, fstatSync, readFileSync, constants } from 'node:fs'
import { isAbsolute } from 'node:path'
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
export class AgentSettingsError extends Error {
  constructor(public readonly code: 'agent_settings_conflict' | 'agent_key_storage_unavailable') { super(code) }
}
function encryptionKey(db: Database): Buffer | undefined {
  const value = process.env.RUE_SETTINGS_ENCRYPTION_KEY
  if (value) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return undefined
    const key = Buffer.from(value, 'base64')
    return key.length === 32 ? key : undefined
  }
  // Operator-provisioned, backed up separately from the encrypted database.
  // Never generate or replace a key automatically when reading settings.
  if (!isAbsolute(db.name)) return undefined
  let fd: number | undefined
  try {
    fd = openSync(`${db.name}.agent-key`, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) return undefined
    return readFileSync(fd)
  } catch { return undefined } finally { if (fd !== undefined) closeSync(fd) }
}
function row(db: Database, owner: string): Row | undefined {
  return db.prepare('SELECT settings, encrypted_key, revision FROM agent_settings WHERE owner_subject=?').get(owner) as Row | undefined
}
export function agentSettings(db: Database, owner: string) {
  const current = row(db, owner)
  const settings = current ? AgentSettingsSchema.parse(JSON.parse(current.settings)) : defaultAgentSettings
  return { ...settings, revision: current?.revision ?? 0, apiKeyConfigured: Boolean(current?.encrypted_key), keyStorageAvailable: Boolean(encryptionKey(db)) }
}
function encrypt(db: Database, owner: string, secret: string): string {
  const key = encryptionKey(db); if (!key) throw new AgentSettingsError('agent_key_storage_unavailable')
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(JSON.stringify([owner, 'openai'])))
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString('base64')).join('.')
}
export function agentApiKey(db: Database, owner: string): string | undefined {
  const value = row(db, owner)?.encrypted_key
  if (!value) return undefined
  const key = encryptionKey(db); if (!key) throw new AgentSettingsError('agent_key_storage_unavailable')
  try {
    const [iv, tag, encrypted] = value.split('.').map(value => Buffer.from(value, 'base64'))
    if (!iv || !tag || !encrypted) throw new Error('Invalid ciphertext')
    const cipher = createDecipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(JSON.stringify([owner, 'openai'])))
    cipher.setAuthTag(tag)
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8')
  } catch { throw new AgentSettingsError('agent_key_storage_unavailable') }
}
export function saveAgentSettings(db: Database, owner: string, input: z.infer<typeof AgentSettingsUpdateSchema>) {
  return db.transaction(() => {
    const current = row(db, owner)
    if (input.expectedOwnerSubject !== owner || (current?.revision ?? 0) !== input.expectedRevision) throw new AgentSettingsError('agent_settings_conflict')
    const encrypted = input.apiKey === undefined ? current?.encrypted_key ?? null : input.apiKey === null ? null : encrypt(db, owner, input.apiKey)
    const settings = AgentSettingsSchema.parse({ harness: input.harness, provider: input.provider, model: input.model, systemPrompt: input.systemPrompt })
    db.prepare('INSERT INTO agent_settings VALUES (?, ?, ?, ?) ON CONFLICT(owner_subject) DO UPDATE SET settings=excluded.settings, encrypted_key=excluded.encrypted_key, revision=excluded.revision')
      .run(owner, JSON.stringify(settings), encrypted, input.expectedRevision + 1)
    return agentSettings(db, owner)
  }).immediate()
}
