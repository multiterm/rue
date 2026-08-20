import { describe, it, expect } from 'vitest'
import { agentSystemPrompt, createAgentTool } from '../../../../src/renderer/src/lib/tools/agentTool.js'
import { createTaskTools } from '../../../../src/renderer/src/lib/tools/taskTool.js'
import type { ToolContext } from '../../../../src/renderer/src/lib/tools/types.js'
import type { RueSettings } from '../../../../src/preload/index.js'

const ctx: ToolContext = {
  scopes: [],
  settings: {} as unknown as RueSettings,
  signal: new AbortController().signal,
  confirm: async () => true
}

describe('createAgentTool', () => {
  it('delegates the task to the spawner with the requested agent type', async () => {
    const tool = createAgentTool(async ({ agentType, prompt }) => ({
      text: `[${agentType}] ${prompt}`,
      turns: 1
    }))
    const result = await tool.call(
      tool.parseInput({ description: 'do x', prompt: 'do it', agent_type: 'explore' }),
      ctx
    )
    expect(result.content).toBe('[explore] do it')
  })

  it('defaults to the general agent type', async () => {
    const tool = createAgentTool(async ({ agentType }) => ({ text: agentType, turns: 1 }))
    const result = await tool.call(tool.parseInput({ description: 'x', prompt: 'p' }), ctx)
    expect(result.content).toBe('general')
  })
})

describe('agentSystemPrompt', () => {
  it('frames the explore agent as read-only', () => {
    expect(agentSystemPrompt('explore')).toContain('read-only')
    expect(agentSystemPrompt('general')).not.toContain('read-only')
  })
})

describe('createTaskTools', () => {
  it('TaskWrite replaces the checklist and TaskList reads it back', async () => {
    const [taskWrite, taskList] = createTaskTools()
    await taskWrite.call(
      taskWrite.parseInput({
        tasks: [
          { content: 'First', status: 'done' },
          { content: 'Second', status: 'in_progress' }
        ]
      }),
      ctx
    )
    const listed = await taskList.call(taskList.parseInput({}), ctx)
    expect(listed.content).toContain('[x] First')
    expect(listed.content).toContain('[~] Second')
  })

  it('starts with an empty checklist', async () => {
    const [, taskList] = createTaskTools()
    const listed = await taskList.call(taskList.parseInput({}), ctx)
    expect(listed.content).toContain('no tasks')
  })
})
