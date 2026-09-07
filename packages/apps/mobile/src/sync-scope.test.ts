import { expect, test } from 'vitest'
import { SyncScope } from './sync-scope'

test('late snapshots cannot overwrite a different conversation', () => {
  const scope = new SyncScope()
  const first = scope.select('user-a/session-a')
  const second = scope.select('user-a/session-b')
  expect(first()).toBe(false)
  expect(second()).toBe(true)
})
test('sign-out invalidates outstanding work even before a new render', () => {
  const scope = new SyncScope()
  const before = scope.select('user-a/session-a')
  scope.invalidate()
  expect(before()).toBe(false)
  expect(scope.select('user-b/session-a')()).toBe(true)
  expect(before()).toBe(false)
})
test('stable scope identity supports single-flight polling without rerender loops', () => {
  const scope = new SyncScope()
  const guard = scope.select('user-a/session-a')
  expect(scope.select('user-a/session-a')).toBe(guard)
  scope.invalidate()
  expect(scope.select('user-a/session-a')).not.toBe(guard)
})
