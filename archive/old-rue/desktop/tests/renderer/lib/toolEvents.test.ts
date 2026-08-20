import { describe, it, expect } from 'vitest'
import { classifyTool, finishToolEvent, toolTitle, type ToolEvent } from '../../../src/renderer/src/lib/toolEvents.js'

describe('toolEvents', () => {
  describe('classifyTool', () => {
    it('classifies edit-like tool names', () => {
      expect(classifyTool('edit_file')).toBe('edit')
      expect(classifyTool('str_replace')).toBe('edit')
      expect(classifyTool('apply_diff')).toBe('edit')
    })

    it('classifies write / read / search / run / fetch', () => {
      expect(classifyTool('write_file')).toBe('write')
      expect(classifyTool('read_file')).toBe('read')
      expect(classifyTool('grep_search')).toBe('search')
      expect(classifyTool('run_command')).toBe('run')
      expect(classifyTool('fetch_url')).toBe('fetch')
    })

    it('falls back to generic tool', () => {
      expect(classifyTool('do_something')).toBe('tool')
    })
  })

  describe('toolTitle', () => {
    it('uses the file basename for file operations', () => {
      expect(toolTitle('edit', 'edit_file', { path: '/a/b/window.ts' })).toBe('Edit(window.ts)')
      expect(toolTitle('read', 'read_file', { file_path: 'src/main.ts' })).toBe('Read(main.ts)')
    })

    it('labels search, run, and fetch from their arguments', () => {
      expect(toolTitle('search', 'grep', { query: 'needle' })).toBe('Search(needle)')
      expect(toolTitle('run', 'exec', { command: 'npm test' })).toBe('Run(npm test)')
      expect(toolTitle('fetch', 'fetch', { url: 'https://example.com/x' })).toBe('Fetch(example.com)')
    })

    it('falls back to the bare tool name', () => {
      expect(toolTitle('tool', 'mystery', {})).toBe('mystery')
    })
  })

  describe('finishToolEvent', () => {
    const base: ToolEvent = { id: '1', name: 'fs__edit', title: 'Edit(x.ts)', kind: 'edit', status: 'running' }

    it('marks an error result as failed', () => {
      const done = finishToolEvent(base, {}, { error: 'permission denied' })
      expect(done.status).toBe('error')
      expect(done.summary).toContain('permission denied')
    })

    it('derives an add/remove summary from edit arguments', () => {
      const done = finishToolEvent(base, { old_string: 'a\nb', new_string: 'a\nb\nc' }, { content: [] })
      expect(done.status).toBe('done')
      expect(done.summary).toBe('+3 −2')
    })

    it('summarizes a generic text result by line count', () => {
      const readBase: ToolEvent = { ...base, kind: 'read' }
      const done = finishToolEvent(readBase, {}, { content: [{ type: 'text', text: 'one\ntwo\nthree' }] })
      expect(done.status).toBe('done')
      expect(done.summary).toBe('3 lines')
      expect(done.detail).toBe('one\ntwo\nthree')
    })
  })
})
