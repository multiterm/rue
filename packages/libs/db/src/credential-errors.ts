export class ProviderKeyError extends Error {
 constructor(readonly status:403|404|409,readonly code:string){super(code)}
}
export class OAuthVaultError extends Error {
 constructor(readonly status:403|404|409|503,readonly code:string){super(code)}
}
