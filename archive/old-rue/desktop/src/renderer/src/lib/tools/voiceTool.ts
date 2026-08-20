import { z } from 'zod'
import { describeMediaError, getAudioStream, recordAudio, stopStream } from '../media.js'
import { transcribe } from '../transcribe.js'
import { defineTool } from './define.js'
import type { Tool } from './types.js'

/**
 * `Dictate` — a model-invocable tool that records a few seconds of microphone
 * audio and transcribes it on-device (Whisper). Use it to capture spoken input
 * from the user without them touching the keyboard.
 */

const DEFAULT_SECONDS = 8
const MAX_SECONDS = 60

export function createDictateTool(): Tool {
  return defineTool({
    name: 'Dictate',
    description:
      "Record speech from the user's microphone for a few seconds and " +
      'transcribe it locally. Use when you want spoken input from the user.',
    schema: z.object({
      seconds: z
        .number()
        .positive()
        .max(MAX_SECONDS)
        .optional()
        .describe(`How long to record (default ${DEFAULT_SECONDS}s, max ${MAX_SECONDS}s).`)
    }),
    source: 'builtin',
    readOnly: true,
    call: async (input, ctx) => {
      const granted = await window.rue.media.ensureAccess('microphone')
      if (!granted) {
        return { content: 'Microphone access was denied by the user or the OS.', isError: true }
      }
      const seconds = Math.min(input.seconds ?? DEFAULT_SECONDS, MAX_SECONDS)
      let stream: MediaStream | null = null
      try {
        stream = await getAudioStream()
        const blob = await recordAudio(stream, seconds * 1000, ctx.signal)
        const text = await transcribe(blob)
        return { content: text ? `Transcript: ${text}` : 'No speech was detected.' }
      } catch (err) {
        return { content: describeMediaError(err), isError: true }
      } finally {
        if (stream) stopStream(stream)
      }
    }
  })
}
