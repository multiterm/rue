export const RUE_SDK_VERSION = '0.1.0'

export interface RueClientOptions {
  baseUrl: string
  /** Keyname bearer token or an async token supplier used before each request. */
  token?: string | (() => string | undefined | Promise<string | undefined>)
  fetch?: typeof globalThis.fetch
}

export interface RueHealth { status: string; version?: string }

export function createRueClient(options: RueClientOptions) {
  const requestFetch = options.fetch ?? globalThis.fetch
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const supplied = typeof options.token === 'function' ? await options.token() : options.token
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    if (init.body) headers.set('content-type', 'application/json')
    if (supplied) headers.set('authorization', `Bearer ${supplied}`)
    const response = await requestFetch(`${baseUrl}${path}`, { ...init, headers })
    if (!response.ok) throw new RueApiError(response.status, await response.text())
    return response.json() as Promise<T>
  }
  return {
    health: () => request<RueHealth>('/health'),
    sessions: () => request<unknown[]>('/session'),
    session: (id: string) => request<unknown>(`/session/${encodeURIComponent(id)}`),
    request,
  }
}

export class RueApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Rue API request failed (${status})`)
    this.name = 'RueApiError'
  }
}
