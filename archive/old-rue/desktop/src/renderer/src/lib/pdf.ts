import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export interface PdfExtraction {
  readonly name: string
  readonly pages: number
  readonly text: string
}

const MAX_CHARS = 40_000

export async function extractPdfText(file: File): Promise<PdfExtraction> {
  const buf = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buf }).promise
  const parts: string[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map(item => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) parts.push(text)
  }

  return {
    name: file.name,
    pages: doc.numPages,
    text: parts.join('\n\n').slice(0, MAX_CHARS)
  }
}
