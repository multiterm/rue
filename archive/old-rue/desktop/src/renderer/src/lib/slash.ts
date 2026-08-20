export interface SlashCommand {
  readonly name: string
  readonly description: string
  readonly transform: (body: string) => string
}

export const SLASH_COMMANDS: ReadonlyArray<SlashCommand> = [
  {
    name: 'tldr',
    description: 'Summarize the attached context or the following text',
    transform: body => `TL;DR — summarize concisely.\n\n${body}`.trim()
  },
  {
    name: 'explain',
    description: 'Explain like I am unfamiliar with this',
    transform: body => `Explain in simple terms.\n\n${body}`.trim()
  },
  {
    name: 'translate',
    description: 'Translate the following text into English (or specify target lang)',
    transform: body => `Translate the following into English. Preserve formatting.\n\n${body}`.trim()
  },
  {
    name: 'rewrite',
    description: 'Rewrite the following clearly and concisely',
    transform: body => `Rewrite for clarity and concision. Preserve meaning.\n\n${body}`.trim()
  },
  {
    name: 'refine',
    description: 'Polish for tone, grammar, and flow',
    transform: body => `Polish the following text for tone, grammar, and flow. Return only the result.\n\n${body}`.trim()
  },
  {
    name: 'bullets',
    description: 'Convert the following into a bulleted list',
    transform: body => `Convert the following into a tight bulleted list.\n\n${body}`.trim()
  },
  {
    name: 'todos',
    description: 'Extract actionable todos',
    transform: body => `Extract actionable todos from the following as a checklist.\n\n${body}`.trim()
  },
  {
    name: 'think',
    description: 'Reason carefully step-by-step before answering',
    transform: body => `Think carefully and reason step-by-step before giving a final answer.\n\n${body}`.trim()
  }
]

export interface ParsedSlash {
  readonly command: SlashCommand | null
  readonly body: string
}

export function parseSlash(input: string): ParsedSlash {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith('/')) return { command: null, body: input }
  const spaceIdx = trimmed.indexOf(' ')
  const name = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase()
  const body = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)
  const cmd = SLASH_COMMANDS.find(c => c.name === name) ?? null
  return { command: cmd, body }
}

export function applySlash(input: string): string {
  const { command, body } = parseSlash(input)
  if (!command) return input
  return command.transform(body)
}
