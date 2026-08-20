import { describe, it, expect, afterEach } from 'vitest'
import { createScheduleTools, parseDuration } from '../../../../src/renderer/src/lib/tools/scheduleTools.js'
import type { ToolContext } from '../../../../src/renderer/src/lib/tools/types.js'
import type { RueSettings } from '../../../../src/preload/index.js'

function ctxWith(signal: AbortSignal): ToolContext {
  return { scopes: [], settings: {} as unknown as RueSettings, signal, confirm: async () => true }
}
const ctx = ctxWith(new AbortController().signal)

function installSchedule(schedule: Record<string, unknown>): void {
  ;(globalThis as { window?: unknown }).window = { rue: { schedule } }
}
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const [sleepTool, scheduleTaskTool, listTool, cancelTool] = createScheduleTools()

describe('parseDuration', () => {
  it('parses unit-suffixed durations into milliseconds', () => {
    expect(parseDuration('5s')).toBe(5_000)
    expect(parseDuration('30m')).toBe(1_800_000)
    expect(parseDuration('2h')).toBe(7_200_000)
    expect(parseDuration('1d')).toBe(86_400_000)
  })

  it('rejects malformed durations', () => {
    expect(parseDuration('10')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('5w')).toBeNull()
  })
})

describe('Sleep tool', () => {
  it('resolves after the (rounded) duration', async () => {
    const result = await sleepTool.call(sleepTool.parseInput({ seconds: 0.001 }), ctx)
    expect(result.content).toBe('Slept 0s.')
  })

  it('returns immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await sleepTool.call(sleepTool.parseInput({ seconds: 60 }), ctxWith(controller.signal))
    expect(result.content).toBe('Sleep interrupted.')
  })
})

describe('ScheduleTask tool', () => {
  it('creates a recurring task from a valid interval', async () => {
    installSchedule({
      create: async () => ({
        id: 'sched-1',
        prompt: 'p',
        recurring: true,
        intervalMs: 1_800_000,
        nextRun: Date.now() + 1_800_000,
        createdAt: Date.now()
      })
    })
    const result = await scheduleTaskTool.call(
      scheduleTaskTool.parseInput({ prompt: 'check builds', every: '30m' }),
      ctx
    )
    expect(result.content).toContain('sched-1')
    expect(result.content).toContain('recurring')
  })

  it('rejects an invalid interval and a missing schedule', async () => {
    const badEvery = await scheduleTaskTool.call(
      scheduleTaskTool.parseInput({ prompt: 'p', every: 'soon' }),
      ctx
    )
    expect(badEvery.isError).toBe(true)

    const noSchedule = await scheduleTaskTool.call(scheduleTaskTool.parseInput({ prompt: 'p' }), ctx)
    expect(noSchedule.isError).toBe(true)
  })
})

describe('ListScheduledTasks / CancelScheduledTask tools', () => {
  it('lists scheduled tasks', async () => {
    installSchedule({
      list: async () => [
        { id: 'sched-1', prompt: 'do it', recurring: false, nextRun: Date.now(), createdAt: Date.now() }
      ]
    })
    const result = await listTool.call(listTool.parseInput({}), ctx)
    expect(result.content).toContain('sched-1')
    expect(result.content).toContain('do it')
  })

  it('reports cancel success and failure', async () => {
    installSchedule({ cancel: async (id: string) => id === 'sched-1' })
    const ok = await cancelTool.call(cancelTool.parseInput({ id: 'sched-1' }), ctx)
    expect(ok.content).toContain('Cancelled')
    const missing = await cancelTool.call(cancelTool.parseInput({ id: 'nope' }), ctx)
    expect(missing.content).toContain('No scheduled task')
  })
})
