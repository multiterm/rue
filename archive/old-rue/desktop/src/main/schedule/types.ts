/**
 * A scheduled task — a prompt the agent runs later, once or on a repeating
 * interval. This is Rue's "agentic looping" primitive: the model schedules
 * follow-up work, and the main-process scheduler fires it back into a query.
 */
export interface ScheduledTask {
  readonly id: string
  readonly prompt: string
  /** True when the task re-arms itself after each run. */
  readonly recurring: boolean
  /** Interval between runs, for recurring tasks. */
  readonly intervalMs?: number
  /** Epoch ms of the next (or only) run. */
  readonly nextRun: number
  readonly createdAt: number
}

/** Arguments accepted by the schedule-create IPC call. */
export interface CreateScheduledTaskInput {
  readonly prompt: string
  /** Recurring interval in ms — set this OR `afterMs`. */
  readonly everyMs?: number
  /** One-time delay in ms before the single run. */
  readonly afterMs?: number
}
