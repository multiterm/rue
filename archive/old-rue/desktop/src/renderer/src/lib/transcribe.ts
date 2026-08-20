import { env, pipeline } from '@huggingface/transformers'

/**
 * Local speech-to-text via Whisper (transformers.js on ONNX Runtime Web). The
 * model runs fully on-device — audio never leaves the machine. The weights are
 * fetched from the Hugging Face CDN on first use and cached by the browser
 * afterwards; bundling `whisper-base` into the installer is a packaging
 * follow-up (see the Phase 8 notes).
 */

env.allowRemoteModels = true
env.allowLocalModels = true

const MODEL_ID = 'onnx-community/whisper-base'

interface AsrResult {
  readonly text: string
}
type AsrPipeline = (audio: Float32Array, options?: Record<string, unknown>) => Promise<AsrResult>

let pipelinePromise: Promise<AsrPipeline> | null = null

/** Lazily build (and memoize) the Whisper ASR pipeline. */
function loadPipeline(): Promise<AsrPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'q8'
    }) as unknown as Promise<AsrPipeline>
  }
  return pipelinePromise
}

/** Transcribe a recorded audio blob to text using on-device Whisper. */
export async function transcribe(blob: Blob): Promise<string> {
  const samples = await decodeToMono16k(blob)
  const asr = await loadPipeline()
  const result = await asr(samples)
  return (result.text ?? '').trim()
}

/** Decode + resample an audio blob to the 16 kHz mono Float32 Whisper wants. */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer()
  const decodeCtx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(bytes)
  } finally {
    await decodeCtx.close()
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * 16_000))
  const offline = new OfflineAudioContext(1, frames, 16_000)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}
