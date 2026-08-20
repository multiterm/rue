import { describe, it, expect } from 'vitest'
import { BUNDLED_SKILLS, createSkillTool, expandSkill } from '../../../../src/renderer/src/lib/skills/index.js'
import type { ToolContext } from '../../../../src/renderer/src/lib/tools/types.js'
import type { RueSettings, Skill } from '../../../../src/preload/index.js'

const ctx: ToolContext = {
  scopes: [],
  settings: {} as unknown as RueSettings,
  signal: new AbortController().signal,
  confirm: async () => true
}

const greet: Skill = {
  name: 'greet',
  description: 'Greet someone',
  body: 'Say hi to $ARGUMENTS',
  source: 'bundled',
  userInvocable: true,
  modelInvocable: true
}

describe('expandSkill', () => {
  it('substitutes $ARGUMENTS', () => {
    expect(expandSkill(greet, 'Sam')).toBe('Say hi to Sam')
  })

  it('appends arguments when the body has no placeholder', () => {
    expect(expandSkill({ ...greet, body: 'Be brief.' }, 'extra')).toBe('Be brief.\n\nextra')
  })
})

describe('createSkillTool', () => {
  it('enumerates model-invocable skills in its description', () => {
    const tool = createSkillTool(BUNDLED_SKILLS)
    expect(tool.name).toBe('Skill')
    expect(tool.description).toContain('tldr')
  })

  it('expands a known skill and errors on an unknown one', async () => {
    const tool = createSkillTool([greet])
    const ok = await tool.call(tool.parseInput({ name: 'greet', arguments: 'Sam' }), ctx)
    expect(ok.content).toBe('Say hi to Sam')
    const bad = await tool.call(tool.parseInput({ name: 'missing' }), ctx)
    expect(bad.isError).toBe(true)
  })
})
