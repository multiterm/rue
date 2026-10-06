export class RuntimeControlError extends Error {
  constructor(readonly status: 403 | 404 | 409, readonly code: string) { super(code) }
}
interface ExpectedGrant { expectedOwnerSubject: string; expectedRevision: number }
export type RuntimeControlGrantInput = ExpectedGrant & (
  | { enabled: false }
  | { enabled: true; expectedAgentRevision: number; expectedWorkerId: string; expectedConnectionId: string; expiresInSeconds: 3600 | 86400 | 604800; acknowledgeHostControl: true }
)
/** Existing HTTP control uses a bearer credential; socket callers additionally
 * bind the request to their active instance. Missing instance is never resolved
 * from stored state as if the caller had supplied it. */
export interface RuntimeControlAuthority { id: string; token: string; instance?: string }
