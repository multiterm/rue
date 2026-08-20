import { net } from 'electron'
import { normalizeUrl, extractTitle, htmlToText } from './html.js'

export interface WebPageResult {
  readonly url: string
  readonly title: string
  readonly text: string
}

const MAX_CHARS = 20_000

export async function fetchWebPage(rawUrl: string): Promise<WebPageResult> {
  const url = normalizeUrl(rawUrl)
  const response = await net.fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new WebFetchError(`HTTP ${response.status}`, url, response.status)
  }
  const html = await response.text()
  const title = extractTitle(html) ?? url
  const text = htmlToText(html).slice(0, MAX_CHARS)
  return { url, title, text }
}

class WebFetchError extends Error {
  constructor(message: string, public readonly url: string, public readonly status: number) {
    super(`Web fetch failed for ${url}: ${message}`)
    this.name = 'WebFetchError'
  }
}
