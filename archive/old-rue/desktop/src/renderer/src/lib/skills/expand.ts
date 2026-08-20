import type { Skill } from '../../../../preload/index.js'

/**
 * Expand a skill into a concrete prompt. `$ARGUMENTS` in the body is replaced
 * with the caller's text; a body with no placeholder simply has the arguments
 * appended, so even a placeholder-free skill still receives its input.
 */
export function expandSkill(skill: Skill, args: string): string {
  const trimmed = args.trim()
  if (skill.body.includes('$ARGUMENTS')) {
    return skill.body.replace(/\$ARGUMENTS/g, trimmed).trim()
  }
  return trimmed ? `${skill.body}\n\n${trimmed}`.trim() : skill.body.trim()
}
