import { describe, it, expect, afterEach, vi } from 'vitest'

// transcribe.ts pulls in @huggingface/transformers (installed in real
// environments only) — stub it so the voice modules load under test.
vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline: async () => async () => ({ text: '' })
}))

import { describeVoiceError, isVoiceSupported } from '../../../src/renderer/src/lib/voice.js'
import { createDictateTool } from '../../../src/renderer/src/lib/tools/voiceTool.js'
import type { ToolContext } from '../../../src/renderer/src/lib/tools/types.js'
import type { RueSettings } from '../../../src/preload/index.js'

const ctx: ToolContext = {
  scopes: [],
  settings: {} as unknown as RueSettings,
  signal: new AbortController().signal,
  confirm: async () => true
}

afterEach(() => vi.unstubAllGlobals())

describe('isVoiceSupported', () => {
  it('is false without the MediaRecorder API', () => {
    expect(isVoiceSupported()).toBe(false)
  })
})

describe('describeVoiceError', () => {
  it('produces a legible message from a media error', () => {
    expect(describeVoiceError({ name: 'NotAllowedError' })).toContain('denied')
  })
})

describe('Dictate tool', () => {
  it('is a read-only tool named Dictate', () => {
    const tool = createDictateTool()
    expect(tool.name).toBe('Dictate')
    expect(tool.readOnly).toBe(true)
  })

  it('errors when microphone access is denied', async () => {
    vi.stubGlobal('window', { rue: { media: { ensureAccess: async () => false } } })
    const tool = createDictateTool()
    const result = await tool.call(tool.parseInput({}), ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('denied')
  })
})
