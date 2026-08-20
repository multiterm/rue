export interface SearchHit {
  readonly title: string
  readonly url: string
  readonly snippet: string
}

export function formatSummary(query: string, hits: ReadonlyArray<SearchHit>): string {
  const parts = [`[Web search: ${query}]`, '']
  hits.forEach((h, i) => {
    parts.push(`## [${i + 1}] ${h.title}`, h.url, '', h.snippet, '')
  })
  return parts.join('\n')
}
