export class WorkerError extends Error {
  constructor(readonly status: 400 | 401 | 404 | 409 | 429, readonly code: string) { super(code) }
}
export interface WorkerAuthority { id: string; secret: string; instance: string; generation: number }
