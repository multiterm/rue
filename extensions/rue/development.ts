import { readFileSync } from 'node:fs'

/** Return only deployment-owned public origins; never return credentials or consult the Pi cwd. */
export function developmentOrigins(path: URL = new URL('../../.sandblocks/sandbox-development.json', import.meta.url)) {
  const state = JSON.parse(readFileSync(path, 'utf8')) as { previewUrls?: Array<{ service?: string; url?: string }> }
  function origin(service: string) {
    const matches = state.previewUrls?.filter(item => item.service === service) ?? []
    if (matches.length !== 1 || typeof matches[0]?.url !== 'string') throw Error('Development deployment URL unavailable')
    const url = new URL(matches[0].url)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Invalid development deployment origin')
    return url.origin
  }
  return { api: origin('api'), webapp: origin('webapp') }
}
