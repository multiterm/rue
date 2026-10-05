export class TerminalPairingError extends Error {
 constructor(readonly code:'invalid_request'|'pairing_unavailable'|'already_approved'|'already_linked'|'invalid_pairing'|'invalid_terminal_credential'){super(code)}
}
export class RelayError extends Error{constructor(readonly code:string){super(code)}}
export interface TerminalConnection {
 id:string;ownerSubject:string;sessionId:string;piSessionId:string
 expiresAt:number;activatedAt:number|null;revokedAt:number|null
}
