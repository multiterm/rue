import { z } from 'zod'
import { defineTool } from './define.js'
import type { Tool } from './types.js'

/**
 * Agentic-looping tools: `Sleep` pauses the current loop; `ScheduleTask`,
 * `ListScheduledTasks` and `CancelScheduledTask` let the agent queue prompts
 * to run later or on a repeating interval (the main-process scheduler fires
 * them back as fresh queries).
 */

const MAX_SLEEP_SECONDS = 300

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
}

/** Parse a duration like `30m`, `2h`, `1d`. Returns ms, or null if invalid. */
export function parseDuration(input: string): number | null {
  const match = /^(\d+)\s*([smhd])$/.exec(input.trim().toLowerCase())
  if (!match) return null
  return Number(match[1]) * UNIT_MS[match[2]]
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve()
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function createScheduleTools(): ReadonlyArray<Tool> {
  return [sleepTool, scheduleTaskTool, listScheduledTasksTool, cancelScheduledTaskTool]
}

const sleepTool = defineTool({
  name: 'Sleep',
  description:
    'Pause for a number of seconds before continuing the loop — useful while ' +
    'waiting on an external process. Capped at 300s; interrupted if the user stops.',
  schema: z.object({
    seconds: z.number().positive().describe('Seconds to sleep (max 300).')
  }),
  source: 'builtin',
  readOnly: true,
  call: async (input, ctx) => {
    const seconds = Math.min(Math.round(input.seconds), MAX_SLEEP_SECONDS)
    await sleep(seconds * 1000, ctx.signal)
    return { content: ctx.signal.aborted ? 'Sleep interrupted.' : `Slept ${seconds}s.` }
  }
})

const scheduleTaskTool = defineTool({
  name: 'ScheduleTask',
  description:
    'Schedule a prompt to run later — once, or on a repeating interval. Pass ' +
    '`every` for a recurring task or `after` for a one-time delay. Durations ' +
    'look like "30m", "2h", "1d".',
  schema: z.object({
    prompt: z.string().describe('The prompt to run when the task fires.'),
    every: z.string().optional().describe('Recurring interval, e.g. "30m", "6h", "1d".'),
    after: z.string().optional().describe('One-time delay before running, e.g. "10m", "1h".')
  }),
  source: 'builtin',
  readOnly: false,
  call: async input => {
    const everyMs = input.every ? parseDuration(input.every) : null
    const afterMs = input.after ? parseDuration(input.after) : null
    if (input.every && everyMs === null) {
      return { content: `Invalid interval "${input.every}". Use forms like "30m", "2h", "1d".`, isError: true }
    }
    if (input.after && afterMs === null) {
      return { content: `Invalid delay "${input.after}". Use forms like "10m", "1h".`, isError: true }
    }
    if (everyMs === null && afterMs === null) {
      return { content: 'Provide either `every` (recurring) or `after` (one-time).', isError: true }
    }
    const task = await window.rue.schedule.create({
      prompt: input.prompt,
      everyMs: everyMs ?? undefined,
      afterMs: afterMs ?? undefined
    })
    const when = new Date(task.nextRun).toLocaleString()
    const cadence = task.recurring ? `recurring every ${input.every}` : 'one-time'
    return { content: `Scheduled task ${task.id} (${cadence}). Next run: ${when}.` }
  }
})

const listScheduledTasksTool = defineTool({
  name: 'ListScheduledTasks',
  description: 'List the prompts currently scheduled to run later.',
  schema: z.object({}),
  source: 'builtin',
  defer: true,
  readOnly: true,
  searchHint: 'scheduled tasks list cron',
  call: async () => {
    const tasks = await window.rue.schedule.list()
    if (tasks.length === 0) return { content: 'No scheduled tasks.' }
    return {
      content: tasks
        .map(task => {
          const cadence = task.recurring ? `every ${Math.round((task.intervalMs ?? 0) / 60_000)}m` : 'once'
          return `- ${task.id} (${cadence}, next ${new Date(task.nextRun).toLocaleString()}): ${task.prompt}`
        })
        .join('\n')
    }
  }
})

const cancelScheduledTaskTool = defineTool({
  name: 'CancelScheduledTask',
  description: 'Cancel a scheduled task by its id.',
  schema: z.object({ id: z.string().describe('The scheduled task id.') }),
  source: 'builtin',
  defer: true,
  readOnly: false,
  searchHint: 'scheduled tasks cancel delete cron',
  call: async input => {
    const cancelled = await window.rue.schedule.cancel(input.id)
    return { content: cancelled ? `Cancelled task ${input.id}.` : `No scheduled task with id ${input.id}.` }
  }
})
