import { createWorker, type Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng')
  }
  return workerPromise
}

export async function ocrDataUrl(dataUrl: string): Promise<string> {
  const worker = await getWorker()
  const result = await worker.recognize(dataUrl)
  return result.data.text.trim()
}

export async function disposeOcr(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise
    await worker.terminate()
    workerPromise = null
  }
}
