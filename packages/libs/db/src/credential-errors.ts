export class AgentSettingsError extends Error {
 constructor(readonly code:'agent_settings_conflict'|'agent_key_storage_unavailable'){super(code)}
}
export class ProviderKeyError extends Error {
 constructor(readonly status:403|404|409,readonly code:string){super(code)}
}
export class OAuthVaultError extends Error {
 constructor(readonly status:403|404|409|503,readonly code:string){super(code)}
}
