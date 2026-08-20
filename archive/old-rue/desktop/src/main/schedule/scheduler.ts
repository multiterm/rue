import Store from 'electron-store'
import { ipcMain, type WebContents } from 'electron'
import type { CreateScheduledTaskInput, ScheduledTask } from './types.js'

/**
 * The scheduled-task runner. Tasks persist in their own electron-store file so
 * they survive restarts; a 30s ticker fires due tasks back into the renderer
 * as `rue:schedule:fire` events, which run them as fresh queries.
 */

interface ScheduleStore {
  tasks: ScheduledTask[]
}

const TICK_MS = 30_000

const store = new Store<ScheduleStore>({ name: 'rue-schedule', defaults: { tasks: [] } })

let target: WebContents | null = null
let ticker: ReturnType<typeof setInterval> | null = null

/** Point the scheduler at the window that should run fired tasks. */
export function setScheduleTarget(webContents: WebContents): void {
  target = webContents
}

function getTasks(): ScheduledTask[] {
  return store.get('tasks')
}

function setTasks(tasks: ReadonlyArray<ScheduledTask>): void {
  store.set('tasks', [...tasks])
}

export function createScheduledTask(input: CreateScheduledTaskInput): ScheduledTask {
  const now = Date.now()
  const recurring = typeof input.everyMs === 'number' && input.everyMs > 0
  const delay = recurring ? (input.everyMs as number) : Math.max(0, input.afterMs ?? 0)
  const task: ScheduledTask = {
    id: `sched-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    prompt: input.prompt,
    recurring,
    intervalMs: recurring ? input.everyMs : undefined,
    nextRun: now + delay,
    createdAt: now
  }
  setTasks([...getTasks(), task])
  return task
}

export function listScheduledTasks(): ReadonlyArray<ScheduledTask> {
  return getTasks()
}

export function cancelScheduledTask(id: string): boolean {
  const tasks = getTasks()
  const remaining = tasks.filter(task => task.id !== id)
  setTasks(remaining)
  return remaining.length !== tasks.length
}

/** Fire every due task; re-arm recurring ones, drop one-shot ones. */
function tick(): void {
  const now = Date.now()
  const tasks = getTasks()
  if (!tasks.some(task => task.nextRun <= now)) return

  const remaining: ScheduledTask[] = []
  for (const task of tasks) {
    if (task.nextRun > now) {
      remaining.push(task)
      continue
    }
    target?.send('rue:schedule:fire', { id: task.id, prompt: task.prompt })
    if (task.recurring && task.intervalMs) {
      remaining.push({ ...task, nextRun: now + task.intervalMs })
    }
  }
  setTasks(remaining)
}

export function startScheduler(): void {
  if (ticker) return
  ticker = setInterval(tick, TICK_MS)
}

export function stopScheduler(): void {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

export function registerScheduleIpc(): void {
  ipcMain.handle('rue:schedule:create', (_e, input: CreateScheduledTaskInput) => createScheduledTask(input))
  ipcMain.handle('rue:schedule:list', () => listScheduledTasks())
  ipcMain.handle('rue:schedule:cancel', (_e, id: string) => cancelScheduledTask(id))
}
