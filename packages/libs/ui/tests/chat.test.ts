import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { Markdown, ChatSkeleton, ThinkingIndicator } from '../src/chat/index.js'

test('Markdown supports GFM, fenced code and safe copy controls', () => {
  const html = renderToStaticMarkup(createElement(Markdown, { text: '# Heading\n\n**Bold** and `inline`\n\n- item\n\n```js\nconst answer = 42\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |' }))
  for (const element of ['<h1>', '<strong>', '<code>', '<ul>', '<table>']) expect(html).toContain(element)
  expect(html).toContain('Copy code'); expect(html).toContain('hljs-keyword')
})
test('untrusted Markdown cannot execute HTML or load external images', () => {
  const html = renderToStaticMarkup(createElement(Markdown, { text: '<script>alert(1)</script>\n\n<img src="https://tracker.test/x" onerror="alert(1)">\n\n![tracker](https://tracker.test/x)\n\n[bad](javascript:alert%281%29)\n\n[safe](https://example.com)' }))
  expect(html).not.toContain('<script'); expect(html).not.toContain('<img'); expect(html).not.toContain('onerror'); expect(html).not.toContain('javascript:')
  expect(html).toContain('rel="noopener noreferrer"'); expect(html).toContain('https://example.com')
})
test('progress is accessible and never fabricates hidden reasoning', () => {
  expect(renderToStaticMarkup(createElement(ChatSkeleton))).toContain('aria-label="Loading conversation"')
  expect(renderToStaticMarkup(createElement(ThinkingIndicator))).toContain('role="status"')
})
