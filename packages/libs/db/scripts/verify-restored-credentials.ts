import {sql} from 'drizzle-orm'
import {getTableConfig} from 'drizzle-orm/pg-core'
import {postgresSchema} from '../src/postgres/schema.js'
import type {RuePostgresDatabase} from '../src/postgres/client.js'

/** Operator-only verification, never a credential export or provider request.
 * The caller supplies the original checkpoint key's authenticated decryptor.
 * No plaintext, scopes, ciphertext, IDs or underlying errors leave this helper. */
export async function verifyRestoredCredentials(db:RuePostgresDatabase,expectedDatabase:string,decrypt:(scope:string[],ciphertext:string)=>string){
 if(!/^rue_(rehearsal|restore)_[a-f0-9]{32}$/.test(expectedDatabase))throw Error('credential_check_disposable_database_required')
 try{
  const encryptedColumns=Object.values(postgresSchema).flatMap(table=>{const config=getTableConfig(table);return config.columns.filter(column=>column.name.startsWith('encrypted_')).map(column=>`${config.name}.${column.name}`)}).sort()
  if(encryptedColumns.join(',')!==['agent_settings.encrypted_key','managed_agents.encrypted_grant','mcp_profiles.encrypted_env','project_bindings.encrypted_key','provider_keys.encrypted_key','provider_oauth_credentials.encrypted_credential','push_subscriptions.encrypted_subscription'].sort().join(','))throw Error('credential_inventory_changed')
  return await db.transaction(async tx=>{
  const [identity]=await tx.execute<{name:string}>(sql`SELECT current_database() AS name`)
  if(identity?.name!==expectedDatabase)throw Error('identity_mismatch')
  const actualColumns=await tx.execute<{name:string}>(sql`SELECT table_name||'.'||column_name AS name FROM information_schema.columns WHERE table_schema='public' AND column_name ~ '^encrypted_'`)
  if(actualColumns.map(column=>column.name).sort().join(',')!==encryptedColumns.join(','))throw Error('credential_inventory_changed')
  const checked={agent_settings:0,provider_keys:0,provider_oauth_credentials:0,mcp_profiles:0,project_bindings:0,push_subscriptions:0}
  const [transient]=await tx.execute<{n:number}>(sql`SELECT count(*)::int AS n FROM public.managed_agents WHERE encrypted_grant IS NOT NULL`)
  if(transient?.n!==0)throw Error('transient_grants_remaining')
  const rows=await tx.execute<{kind:keyof typeof checked;scope:string[];ciphertext:string}>(sql`
   SELECT 'agent_settings' AS kind,ARRAY[owner_subject,'openai'] AS scope,encrypted_key AS ciphertext FROM public.agent_settings WHERE encrypted_key IS NOT NULL
   UNION ALL SELECT 'provider_keys',ARRAY[owner_subject,'provider-key',provider],encrypted_key FROM public.provider_keys WHERE encrypted_key IS NOT NULL
   UNION ALL SELECT 'provider_oauth_credentials',ARRAY[owner_subject,'provider-oauth',provider],encrypted_credential FROM public.provider_oauth_credentials WHERE encrypted_credential IS NOT NULL
   UNION ALL SELECT 'mcp_profiles',ARRAY[owner_subject,'mcp-profile',id],encrypted_env FROM public.mcp_profiles WHERE encrypted_env IS NOT NULL
   UNION ALL SELECT 'project_bindings',ARRAY[owner_subject,'project-binding',id,tenancy_origin],encrypted_key FROM public.project_bindings WHERE encrypted_key IS NOT NULL
   UNION ALL SELECT 'push_subscriptions',ARRAY[owner_subject,'web-push',id],encrypted_subscription FROM public.push_subscriptions`)
  for(const row of rows){
   const plaintext=decrypt(row.scope,row.ciphertext)
   if(typeof plaintext!=='string'||!plaintext.length)throw Error('empty_credential')
   checked[row.kind]++
  }
  const total=Object.values(checked).reduce((a,b)=>a+b,0)
  return {credentialDecryptionVerified:total>0,checked,total}
 },{isolationLevel:'repeatable read',accessMode:'read only'})}
 catch{throw Error('restored_credential_verification_failed')}
}
