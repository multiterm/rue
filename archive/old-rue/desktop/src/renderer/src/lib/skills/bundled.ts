import type { Skill } from '../../../../preload/index.js'

/**
 * Skills compiled into Rue. These mirror the built-in slash commands, but
 * as skills they are also model-invocable through the `Skill` tool. Disk
 * skills (userData/skills/) are loaded alongside these at runtime.
 */

function bundled(name: string, description: string, body: string): Skill {
  return { name, description, body, source: 'bundled', userInvocable: true, modelInvocable: true }
}

export const BUNDLED_SKILLS: ReadonlyArray<Skill> = [
  bundled('tldr', 'Summarize the attached context or text concisely', 'Give a TL;DR — summarize the following concisely.\n\n$ARGUMENTS'),
  bundled('explain', 'Explain something in plain, simple terms', 'Explain the following in simple terms, as if to someone unfamiliar with it.\n\n$ARGUMENTS'),
  bundled('translate', 'Translate text into English (or a target language)', 'Translate the following into English (or the requested target language). Preserve formatting.\n\n$ARGUMENTS'),
  bundled('rewrite', 'Rewrite text clearly and concisely', 'Rewrite the following for clarity and concision. Preserve the meaning.\n\n$ARGUMENTS'),
  bundled('refine', 'Polish text for tone, grammar, and flow', 'Polish the following text for tone, grammar, and flow. Return only the result.\n\n$ARGUMENTS'),
  bundled('bullets', 'Convert text into a bulleted list', 'Convert the following into a tight bulleted list.\n\n$ARGUMENTS'),
  bundled('todos', 'Extract actionable todos as a checklist', 'Extract actionable todos from the following as a checklist.\n\n$ARGUMENTS'),
  bundled('think', 'Reason step-by-step before answering', 'Think carefully and reason step-by-step before giving a final answer.\n\n$ARGUMENTS')
]
