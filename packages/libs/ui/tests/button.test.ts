import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { Button, ButtonLink } from '../src/button/index.js'

test('shared buttons default to non-submit, forward disabled/loading and keep bare geometry', () => {
  const html = renderToStaticMarkup(createElement(Button, { variant: 'bare', disabled: true }, 'Action'))
  expect(html).toContain('type="button"'); expect(html).toContain('disabled=""')
  expect(html).toContain('cursor-pointer'); expect(html).toContain('focus-visible:')
  expect(html).not.toContain('min-h-9'); expect(html).not.toContain('<span')
  const loading = renderToStaticMarkup(createElement(Button, { isLoading: true, type: 'submit' }, 'Save'))
  expect(loading).toContain('disabled=""'); expect(loading).toContain('aria-busy="true"'); expect(loading).toContain('type="submit"')
})
test('disabled links remove href, keyboard navigation and event callbacks', () => {
  const onClick = vi.fn(), event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
  const link = ButtonLink({ href: 'https://example.test', disabled: true, onClick, children: 'Open' })
  expect(link.props.href).toBeUndefined(); expect(link.props.tabIndex).toBe(-1); expect(link.props['aria-disabled']).toBe(true)
  link.props.onClick(event); link.props.onAuxClick(event)
  expect(onClick).not.toHaveBeenCalled(); expect(event.preventDefault).toHaveBeenCalledTimes(2)
})
