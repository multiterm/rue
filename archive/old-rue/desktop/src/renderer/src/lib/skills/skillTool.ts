import { z } from 'zod'
import type { Skill } from '../../../../preload/index.js'
import { defineTool } from '../tools/define.js'
import type { Tool } from '../tools/types.js'
import { expandSkill } from './expand.js'

/**
 * Build the `Skill` tool from the available skills. It is a single meta-tool:
 * its description enumerates the skill catalog, and calling it expands the
 * named skill into instructions the model then follows (inline invocation).
 *
 * Bundled / user skills expand a local template. MCP-sourced skills instead
 * fetch their rendered prompt from the originating server via `prompts/get`.
 */
export function createSkillTool(skills: ReadonlyArray<Skill>): Tool {
  const invocable = skills.filter(skill => skill.modelInvocable)
  const catalog = invocable
    .map(skill => `- ${skill.name}: ${skill.description}${skill.whenToUse ? ` — use when ${skill.whenToUse}` : ''}`)
    .join('\n')

  return defineTool({
    name: 'Skill',
    description:
      'Invoke a saved skill — a reusable instruction set. The result is the ' +
      'skill\'s instructions; follow them in your next step. Available skills:\n' +
      (catalog || '(none)'),
    schema: z.object({
      name: z.string().describe('Name of the skill to invoke.'),
      arguments: z.string().optional().describe('Text or arguments passed to the skill.')
    }),
    source: 'skill',
    readOnly: true,
    call: async input => {
      const skill = invocable.find(s => s.name.toLowerCase() === input.name.toLowerCase())
      if (!skill) {
        const names = invocable.map(s => s.name).join(', ') || 'none'
        return { content: `Unknown skill "${input.name}". Available skills: ${names}.`, isError: true }
      }
      if (skill.mcp) {
        try {
          const content = await window.rue.mcp.getPrompt(
            skill.mcp.server,
            skill.mcp.prompt,
            input.arguments ?? ''
          )
          return { content: content || '(the MCP prompt returned no content)' }
        } catch (err) {
          return { content: `Failed to load MCP prompt: ${(err as Error).message}`, isError: true }
        }
      }
      return { content: expandSkill(skill, input.arguments ?? '') }
    }
  })
}
