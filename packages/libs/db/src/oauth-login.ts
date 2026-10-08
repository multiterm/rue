export type OAuthLoginStatus='starting'|'pending'|'authorizing'|'review'|'complete'|'cancelled'|'expired'|'failed'
export interface OAuthLoginIntent {id:string;expectedRevision:number;status:OAuthLoginStatus;expiresAt:number}
export const activeOAuthLoginStatuses:OAuthLoginStatus[]=['starting','pending','authorizing','review']
/** Each mutation is atomic. Provider network calls must remain outside this boundary. */
export interface OAuthLoginRepository {
 get(owner:string,id:string):Promise<OAuthLoginIntent|undefined>
 reserve(owner:string,id:string,expected:number):Promise<{created:boolean;intent:OAuthLoginIntent}>
 transition(owner:string,id:string,from:OAuthLoginStatus[],to:OAuthLoginStatus):Promise<boolean>
 cancel(owner:string,id:string):Promise<void>
 confirm(owner:string,id:string,encrypted:string):Promise<void>
 seal(owner:string,id:string,credential:unknown):string
}
