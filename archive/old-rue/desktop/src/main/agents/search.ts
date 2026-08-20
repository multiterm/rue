import { net, ipcMain } from 'electron'
import { htmlToText } from '../capture/html.js'
import { getSettings } from '../store.js'
import { formatSummary, type SearchHit } from './format.js'

export type { SearchHit }

export interface SearchResult {
  readonly query: string
  readonly hits: ReadonlyArray<SearchHit>
  readonly summary: string
}

const MAX_HITS = 5
const MAX_BODY_CHARS = 2_000

interface SearxngResponse {
  results?: Array<{
    title?: string
    url?: string
    content?: string
  }>
}

export async function search(query: string): Promise<SearchResult> {
  const { searxngUrl } = getSettings()
  const url = `${searxngUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`

  const response = await net.fetch(url, { method: 'GET' })
  if (!response.ok) {
    throw new SearchError(
      `SearXNG returned ${response.status}. Is the sidecar running at ${searxngUrl}?`,
      response.status
    )
  }

  const json = (await response.json()) as SearxngResponse
  const rawHits = (json.results ?? []).slice(0, MAX_HITS).filter(h => h.url && h.title)

  const enriched = await Promise.all(
    rawHits.map(async (h): Promise<SearchHit> => {
      const baseSnippet = (h.content ?? '').slice(0, 400)
      try {
        const body = await fetchAndExtract(h.url!)
        return {
          title: h.title ?? h.url!,
          url: h.url!,
          snippet: body || baseSnippet
        }
      } catch {
        return { title: h.title ?? h.url!, url: h.url!, snippet: baseSnippet }
      }
    })
  )

  return {
    query,
    hits: enriched,
    summary: formatSummary(query, enriched)
  }
}

async function fetchAndExtract(url: string): Promise<string> {
  const response = await net.fetch(url, { redirect: 'follow' })
  if (!response.ok) return ''
  const html = await response.text()
  return htmlToText(html).slice(0, MAX_BODY_CHARS)
}

export class SearchError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'SearchError'
  }
}

export function registerSearchIpc(): void {
  ipcMain.handle('rue:search', (_e, query: string) => search(query))
}
