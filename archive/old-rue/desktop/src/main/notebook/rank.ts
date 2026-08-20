export interface RankedChunk {
  readonly filePath: string
  readonly text: string
  readonly score: number
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'what', 'how', 'why', 'when', 'where'
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
}

const CHUNK_LINES = 30

export interface FileBlob {
  readonly filePath: string
  readonly text: string
}

export function chunkFile(file: FileBlob): FileBlob[] {
  const lines = file.text.split('\n')
  if (lines.length <= CHUNK_LINES) return [file]

  const chunks: FileBlob[] = []
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    chunks.push({
      filePath: file.filePath,
      text: lines.slice(i, i + CHUNK_LINES).join('\n')
    })
  }
  return chunks
}

export function rank(query: string, files: ReadonlyArray<FileBlob>, topK = 6): RankedChunk[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  const queryFreq = new Map<string, number>()
  for (const t of queryTokens) queryFreq.set(t, (queryFreq.get(t) ?? 0) + 1)

  const chunks: FileBlob[] = []
  for (const f of files) chunks.push(...chunkFile(f))

  const scored: RankedChunk[] = []
  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text)
    if (tokens.length === 0) continue
    const tokenSet = new Map<string, number>()
    for (const t of tokens) tokenSet.set(t, (tokenSet.get(t) ?? 0) + 1)

    let score = 0
    for (const [qt, qf] of queryFreq) {
      const tf = tokenSet.get(qt) ?? 0
      if (tf > 0) score += qf * (1 + Math.log(1 + tf))
    }
    if (score === 0) continue

    score /= Math.sqrt(tokens.length)
    scored.push({ filePath: chunk.filePath, text: chunk.text, score })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}
