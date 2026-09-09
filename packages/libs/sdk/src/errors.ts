export class RueApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Rue API request failed (${status})`)
    this.name = 'RueApiError'
  }
}
