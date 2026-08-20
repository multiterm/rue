import { describeMediaError, getAudioStream, preferredAudioMimeType, stopStream } from './media.js'
import { transcribe } from './transcribe.js'

/**
 * User-facing voice dictation. Recording begins as soon as the microphone
 * opens; calling `stop()` ends the recording and transcribes it on-device with
 * Whisper, delivering the final text through `onTranscript`.
 *
 * This replaces the old Web Speech API path, which never worked in a packaged
 * Electron app (stock Chromium has no Google speech key) — see transcribe.ts.
 */

export interface VoiceSession {
  /** End recording and kick off transcription. */
  readonly stop: () => void
}

export function isVoiceSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

export function describeVoiceError(err: unknown): string {
  return describeMediaError(err)
}

export function startDictation(
  onTranscript: (text: string, isFinal: boolean) => void,
  onError: (message: string) => void,
  deviceId?: string
): VoiceSession {
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let stopRequested = false
  const chunks: Blob[] = []

  // The microphone opens asynchronously; stop() works whether or not the
  // recorder has started yet.
  void getAudioStream(deviceId)
    .then(opened => {
      stream = opened
      recorder = new MediaRecorder(opened, preferredAudioMimeType())
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        if (stream) stopStream(stream)
        if (chunks.length === 0) {
          onError('No audio was captured.')
          return
        }
        const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
        transcribe(blob)
          .then(text => (text ? onTranscript(text, true) : onError('No speech was detected.')))
          .catch(err => onError(`Transcription failed: ${(err as Error).message}`))
      }
      recorder.start()
      if (stopRequested) recorder.stop()
    })
    .catch(err => onError(describeMediaError(err)))

  return {
    stop: () => {
      stopRequested = true
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    }
  }
}
