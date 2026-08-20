import { describe, it, expect, afterEach, vi } from 'vitest'
import { createCameraTool } from '../../../../src/renderer/src/lib/tools/cameraTool.js'
import type { ToolContext } from '../../../../src/renderer/src/lib/tools/types.js'
import type { RueSettings } from '../../../../src/preload/index.js'

const ctx: ToolContext = {
  scopes: [],
  settings: {} as unknown as RueSettings,
  signal: new AbortController().signal,
  confirm: async () => true,
  addImage: () => undefined
}

afterEach(() => vi.unstubAllGlobals())

describe('CameraCapture tool', () => {
  it('is a non-read-only tool named CameraCapture', () => {
    const tool = createCameraTool()
    expect(tool.name).toBe('CameraCapture')
    expect(tool.readOnly).toBe(false)
  })

  it('errors when camera access is denied', async () => {
    vi.stubGlobal('window', { rue: { media: { ensureAccess: async () => false } } })
    const tool = createCameraTool()
    const result = await tool.call(tool.parseInput({}), ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('denied')
  })
})
