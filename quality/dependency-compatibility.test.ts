import { expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const mobile = createRequire(new URL('../packages/apps/mobile/package.json', import.meta.url))
const expo = createRequire(mobile.resolve('expo/package.json'))

test('Expo xcode tooling still generates unique project identifiers with patched UUID', () => {
  const plugins = createRequire(expo.resolve('@expo/config-plugins/package.json'))
  const project = plugins('xcode').project('fixture.pbxproj')
  project.hash = { project: { objects: {} } }
  const first = project.generateUuid(), second = project.generateUuid()
  expect(first).toMatch(/^[A-F0-9]{24}$/)
  expect(second).toMatch(/^[A-F0-9]{24}$/)
  expect(second).not.toBe(first)
})

test('Expo Metro retains image asset dimensions after replacing the vulnerable parser', () => {
  const wrapper = createRequire(expo.resolve('@expo/metro/package.json'))
  const { getAssetSize } = wrapper('metro/private/Assets')
  const path = new URL('../packages/apps/webapp/public/icon-192.png', import.meta.url)
  expect(getAssetSize('png', readFileSync(path), path.pathname)).toMatchObject({ width: 192, height: 192 })
  expect(() => getAssetSize('png', Buffer.alloc(0), 'empty.png')).toThrow()
})
