export class HistoryError extends Error {
  constructor(readonly status: 404 | 409, readonly code: string) { super(code) }
}
