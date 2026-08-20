import { z } from 'zod'
import { captureFrame, describeMediaError, getVideoStream, stopStream } from '../media.js'
import { defineTool } from './define.js'
import type { Tool } from './types.js'

/**
 * `CameraCapture` — a model-invocable tool that grabs a still photo from the
 * user's webcam and attaches it to the conversation (via `ctx.addImage`) so
 * the model can see the user's physical surroundings.
 */
export function createCameraTool(): Tool {
  return defineTool({
    name: 'CameraCapture',
    description:
      "Take a still photo from the user's webcam and attach it for you to " +
      'view. Use this when you need to see the user\'s physical surroundings.',
    schema: z.object({
      reason: z.string().optional().describe('Briefly, what you want to look at.')
    }),
    source: 'builtin',
    readOnly: false,
    call: async (input, ctx) => {
      const granted = await window.rue.media.ensureAccess('camera')
      if (!granted) {
        return { content: 'Camera access was denied by the user or the OS.', isError: true }
      }
      let stream: MediaStream | null = null
      try {
        stream = await getVideoStream()
        const dataUrl = await captureFrame(stream)
        if (!ctx.addImage) {
          return { content: 'Camera capture is not available in this context.', isError: true }
        }
        ctx.addImage(dataUrl)
        const note = input.reason ? ` (${input.reason})` : ''
        return { content: `Captured a webcam photo${note}; it is attached for you to view.` }
      } catch (err) {
        return { content: describeMediaError(err), isError: true }
      } finally {
        if (stream) stopStream(stream)
      }
    }
  })
}
