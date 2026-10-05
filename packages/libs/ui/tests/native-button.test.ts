import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
const captured = vi.hoisted(() => ({ props: undefined as any }))
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  StyleSheet: { flatten: (style: unknown) => style },
  Pressable: (props: any) => { captured.props = props; return typeof props.children === 'function' ? props.children({ pressed: false }) : props.children },
}))
import { NativeButton } from '../src/native/index.js'

test('native disabled/loading controls cannot activate and retain accessibility labels', () => {
  for (const flag of [{ disabled: true }, { isLoading: true }, { accessibilityState: { disabled: true } }]) {
    renderToStaticMarkup(createElement(NativeButton, { ...flag, accessibilityLabel: 'Send', onPress: vi.fn() }, 'Send'))
    expect(captured.props.accessibilityRole).toBe('button')
    expect(captured.props.accessibilityLabel).toBe('Send')
    expect(captured.props.disabled).toBe(true)
    expect(captured.props.focusable).toBe(false)
    expect(captured.props.onPress).toBeUndefined()
    expect(captured.props.style({ pressed: true })).toContainEqual({ opacity: 0.45 })
    expect(captured.props.style({ pressed: true })).toContainEqual({ cursor: 'not-allowed' })
  }
})
test('native controls preserve refs, child/style callbacks, handlers and press feedback', () => {
  const onPress = vi.fn(), ref = { current: null }, child = vi.fn(() => 'Action'), style = vi.fn(() => ({ opacity: 0.5 }))
  renderToStaticMarkup(createElement(NativeButton, { onPress, ref, style }, child))
  expect(captured.props.ref).toBe(ref)
  expect(captured.props.onPress).toBe(onPress)
  expect(child).toHaveBeenCalledWith({ pressed: false })
  expect(captured.props.style({ pressed: true })).toContainEqual({ opacity: 0.36 })
  expect(style).toHaveBeenCalledWith({ pressed: true })
})
