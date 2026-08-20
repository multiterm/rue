import { z } from 'zod'
import { defineTool } from './define.js'
import type { Tool } from './types.js'

/**
 * Session task tools — a lightweight checklist the model maintains while
 * working through a multi-step job. `TaskWrite` replaces the whole list each
 * call; `TaskList` reads it back. The list is scoped to this tool instance
 * (one query), so each turn sees a consistent plan.
 */

type TaskStatus = 'pending' | 'in_progress' | 'done'

interface TaskItem {
  readonly content: string
  readonly status: TaskStatus
}

const MARK: Record<TaskStatus, string> = { pending: ' ', in_progress: '~', done: 'x' }

export function createTaskTools(): ReadonlyArray<Tool> {
  let tasks: ReadonlyArray<TaskItem> = []

  const render = (): string =>
    tasks.length === 0
      ? '(no tasks yet)'
      : tasks.map((task, i) => `${i + 1}. [${MARK[task.status]}] ${task.content}`).join('\n')

  const taskWrite = defineTool({
    name: 'TaskWrite',
    description:
      'Record or update your task checklist for a multi-step job. Pass the ' +
      'COMPLETE list every time — it replaces the previous one. Keep exactly ' +
      'one task in_progress while you work.',
    schema: z.object({
      tasks: z
        .array(
          z.object({
            content: z.string().describe('What the task is.'),
            status: z.enum(['pending', 'in_progress', 'done'])
          })
        )
        .describe('The complete, ordered task list.')
    }),
    source: 'builtin',
    readOnly: true,
    call: async input => {
      tasks = input.tasks.map(task => ({ content: task.content, status: task.status }))
      return { content: `Task list updated:\n${render()}` }
    }
  })

  const taskList = defineTool({
    name: 'TaskList',
    description: 'Show your current task checklist.',
    schema: z.object({}),
    source: 'builtin',
    readOnly: true,
    call: async () => ({ content: render() })
  })

  return [taskWrite, taskList]
}
