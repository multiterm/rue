import { describe, it, expect, afterEach, vi } from 'vitest'
import { describeMediaError, isMediaSupported, listDevices, onDeviceChange } from '../../../src/renderer/src/lib/media.js'

afterEach(() => vi.unstubAllGlobals())

describe('describeMediaError', () => {
  it('maps known getUserMedia error names to legible messages', () => {
    expect(describeMediaError({ name: 'NotAllowedError' })).toContain('denied')
    expect(describeMediaError({ name: 'NotFoundError' })).toContain('No matching')
    expect(describeMediaError({ name: 'NotReadableError' })).toContain('already in use')
    expect(describeMediaError({ name: 'Other', message: 'boom' })).toContain('boom')
  })
})

describe('isMediaSupported', () => {
  it('is false without a mediaDevices API', () => {
    vi.stubGlobal('navigator', {})
    expect(isMediaSupported()).toBe(false)
  })

  it('is true when enumerateDevices is present', () => {
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: () => undefined } })
    expect(isMediaSupported()).toBe(true)
  })
})

describe('listDevices', () => {
  it('filters by kind and fills in fallback labels', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => [
          { deviceId: 'a', label: 'OBSBOT', kind: 'videoinput', groupId: 'g1' },
          { deviceId: 'b', label: '', kind: 'videoinput', groupId: 'g2' },
          { deviceId: 'c', label: 'Mic', kind: 'audioinput', groupId: 'g3' }
        ]
      }
    })
    const cameras = await listDevices('videoinput')
    expect(cameras).toHaveLength(2)
    expect(cameras[0].label).toBe('OBSBOT')
    expect(cameras[1].label).toBe('Camera 2')
  })
})

describe('onDeviceChange', () => {
  it('returns a safe no-op unsubscribe when media is unavailable', () => {
    vi.stubGlobal('navigator', {})
    const off = onDeviceChange(() => undefined)
    expect(() => off()).not.toThrow()
  })
})
