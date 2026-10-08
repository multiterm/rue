import {reportedProviders} from './reported-providers.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Database } from 'better-sqlite3'
import {providerOAuthMetadata} from './provider-oauth.js'
import { agentApiKey, agentSettings, decryptCredential, encryptCredential, encryptionKey, saveAgentSettings } from './agent-settings.js'

export const providerSchema = z.string().max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).refine(value=>value!=='openai-codex')
export type KeyProvider = z.infer<typeof providerSchema>
export const targetSchema = z.object({ type: z.enum(['terminal','worker']), id: z.string().min(1).max(128) }).strict()
import {ProviderKeyError} from '@multiterm/rue-db'
export {ProviderKeyError}
const stored = (db: Database, owner: string, provider: string) => db.prepare('SELECT encrypted_key,revision FROM provider_keys WHERE owner_subject=? AND provider=?').get(owner, provider) as { encrypted_key: string | null; revision: number } | undefined
function metadata(db: Database, owner: string, provider: KeyProvider) {
  if (provider === 'openai') { const value = agentSettings(db, owner); return { configured: value.apiKeyConfigured, revision: value.revision } }
  const value = stored(db, owner, provider)
  return { configured: Boolean(value?.encrypted_key), revision: value?.revision ?? 0 }
}
function audit(db: Database, owner: string, provider: string, action: string, target?: z.infer<typeof targetSchema>) {
  db.prepare('INSERT INTO provider_key_audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(), owner, provider, action, target?.type ?? null, target?.id ?? null, Date.now())
}
export function providerKeys(db: Database, owner: string) {
  const saved=db.prepare('SELECT provider FROM provider_keys WHERE owner_subject=?').all(owner) as Array<{provider:string}>
  const providers=[...new Set(['openai','anthropic','google','openrouter',...saved.map(p=>p.provider),...reportedProviders(db,owner).filter(p=>p.auth==='api_key').map(p=>p.id)])].filter(p=>providerSchema.safeParse(p).success)
  return { ownerSubject: owner, keyStorageAvailable: Boolean(encryptionKey(db)), oauth:{ownerSubject:owner,...providerOAuthMetadata(db,owner),runtimeSupported:true}, keys: providers.map(provider => ({ provider, ...metadata(db, owner, provider), model:(db.prepare('SELECT model FROM provider_model_preferences WHERE owner_subject=? AND provider=?').get(owner,provider) as {model:string}|undefined)?.model??null, grants: db.prepare('SELECT target_type AS type,target_id AS id FROM provider_key_grants WHERE owner_subject=? AND provider=?').all(owner, provider) as Array<z.infer<typeof targetSchema>> })) }
}
function revision(db: Database, owner: string, provider: KeyProvider, expected: number, apiKey?: string | null) {
  if (metadata(db, owner, provider).revision !== expected) throw new ProviderKeyError(409, 'provider_key_changed')
  if (provider === 'openai') {
    // Preserve existing OpenAI ciphertext, defaults, API compatibility and backups.
    const settings = agentSettings(db, owner)
    saveAgentSettings(db, owner, { expectedOwnerSubject: owner, expectedRevision: expected, harness: settings.harness, provider: settings.provider, model: settings.model, systemPrompt: settings.systemPrompt, ...(apiKey !== undefined ? { apiKey } : {}) })
  } else {
    const encrypted = apiKey === undefined ? stored(db, owner, provider)?.encrypted_key ?? null : apiKey === null ? null : encryptCredential(db, [owner, 'provider-key', provider], apiKey)
    db.prepare('INSERT INTO provider_keys VALUES(?,?,?,?) ON CONFLICT(owner_subject,provider) DO UPDATE SET encrypted_key=excluded.encrypted_key,revision=excluded.revision').run(owner, provider, encrypted, expected + 1)
  }
}
export function saveProviderKey(db: Database, owner: string, provider: KeyProvider, expected: number, apiKey: string | null,model?:string) {
  return db.transaction(() => {
    revision(db, owner, provider, expected, apiKey)
    if (apiKey === null) {db.prepare('DELETE FROM provider_key_grants WHERE owner_subject=? AND provider=?').run(owner, provider);db.prepare('DELETE FROM provider_model_preferences WHERE owner_subject=? AND provider=?').run(owner,provider)}
    else if(model)db.prepare('INSERT INTO provider_model_preferences VALUES(?,?,?) ON CONFLICT(owner_subject,provider) DO UPDATE SET model=excluded.model').run(owner,provider,model)
    audit(db, owner, provider, apiKey === null ? 'remove' : 'save')
    return providerKeys(db, owner)
  }).immediate()
}
export function grantProviderKey(db: Database, owner: string, provider: KeyProvider, expected: number, target: z.infer<typeof targetSchema>, enabled: boolean) {
  return db.transaction(() => {
    // The SQL relation is selected by a strict enum, never caller-supplied SQL.
    const exists = target.type === 'worker'
      ? db.prepare('SELECT 1 FROM workers WHERE id=? AND owner_subject=? AND revoked_at IS NULL').get(target.id, owner)
      : db.prepare('SELECT 1 FROM terminal_connections WHERE id=? AND owner_subject=? AND revoked_at IS NULL AND activated_at IS NOT NULL AND expires_at>?').get(target.id, owner, Date.now())
    if (enabled && !exists) throw new ProviderKeyError(404, 'credential_target_unavailable')
    if (enabled && !metadata(db, owner, provider).configured) throw new ProviderKeyError(409, 'provider_key_missing')
    revision(db, owner, provider, expected)
    if (enabled) db.prepare('INSERT OR IGNORE INTO provider_key_grants VALUES(?,?,?,?)').run(owner, provider, target.type, target.id)
    else db.prepare('DELETE FROM provider_key_grants WHERE owner_subject=? AND provider=? AND target_type=? AND target_id=?').run(owner, provider, target.type, target.id)
    audit(db, owner, provider, enabled ? 'grant' : 'revoke', target)
    return providerKeys(db, owner)
  }).immediate()
}
/** Revoked/re-paired identities must not inherit old grants, even when history keeps its ID. */
export function clearProviderKeyGrants(db: Database, owner: string, target: z.infer<typeof targetSchema>) {
  db.transaction(() => {
    const grants = db.prepare('SELECT provider FROM provider_key_grants WHERE owner_subject=? AND target_type=? AND target_id=?').all(owner, target.type, target.id) as Array<{ provider: string }>
    db.prepare('DELETE FROM provider_key_grants WHERE owner_subject=? AND target_type=? AND target_id=?').run(owner, target.type, target.id)
    for (const { provider } of grants) {
      if (provider === 'openai') db.prepare('UPDATE agent_settings SET revision=revision+1 WHERE owner_subject=?').run(owner)
      else if(provider==='openai-codex')db.prepare('UPDATE provider_oauth_credentials SET revision=revision+1 WHERE owner_subject=? AND provider=?').run(owner,provider)
      else db.prepare('UPDATE provider_keys SET revision=revision+1 WHERE owner_subject=? AND provider=?').run(owner, provider)
      audit(db, owner, provider, 'target_reset', target)
    }
  }).immediate()
}
/** Caller must first validate the target's live credential, instance and lease. */
export function delegatedProviderKeyAvailable(db: Database, owner: string, provider: z.infer<typeof providerSchema>, target: z.infer<typeof targetSchema>) {
  return metadata(db, owner, provider).configured && Boolean(db.prepare('SELECT 1 FROM provider_key_grants WHERE owner_subject=? AND provider=? AND target_type=? AND target_id=?').get(owner, provider, target.type, target.id))
}
export function delegatedProviderKey(db: Database, owner: string, provider: KeyProvider, target: z.infer<typeof targetSchema>) {
  if (!db.prepare('SELECT 1 FROM provider_key_grants WHERE owner_subject=? AND provider=? AND target_type=? AND target_id=?').get(owner, provider, target.type, target.id)) throw new ProviderKeyError(403, 'provider_key_not_granted')
  const value = provider === 'openai' ? agentApiKey(db, owner) : (() => { const encrypted = stored(db, owner, provider)?.encrypted_key; return encrypted ? decryptCredential(db, [owner, 'provider-key', provider], encrypted) : undefined })()
  if (!value) throw new ProviderKeyError(404, 'provider_key_missing')
  audit(db, owner, provider, 'access', target)
  return { provider, apiKey: value }
}
