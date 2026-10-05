import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'
import ts from 'typescript'
import { developmentOrigins } from '../extensions/rue/development.ts'

test('development URLs refresh without caches; missing, duplicate and unsafe origins fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rue-origins-')), path = join(dir, 'deployment.json')
  const save = (urls: unknown[]) => writeFileSync(path, JSON.stringify({ leaseToken: 'must-not-be-returned', previewUrls: urls }))
  const api = { service: 'api', url: 'https://api.example.test' }, web = { service: 'webapp', url: 'https://web.example.test' }
  try {
    save([api, web]); expect(developmentOrigins(pathToFileURL(path))).toEqual({ api: api.url, webapp: web.url })
    save([{ ...api, url: 'https://new.example.test' }, web]); expect(developmentOrigins(pathToFileURL(path)).api).toBe('https://new.example.test')
    for (const urls of [[api], [api, api, web], [{...api,url:'http://api.test'},web], [{...api,url:'https://user:password@api.test'},web], [{...api,url:'https://api.test/path'},web]]) {
      save(urls); expect(() => developmentOrigins(pathToFileURL(path))).toThrow()
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('native application controls use the shared native UI entry point', () => {
  const offenders: string[] = []
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.worktrees', 'dist'].includes(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) scan(path)
      else if (path.endsWith('.tsx')) {
        const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        for (const node of ast.statements) {
          if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== 'react-native') continue
          const bindings = node.importClause?.namedBindings
          if (bindings && ts.isNamedImports(bindings) && bindings.elements.some(item => /^(Button|Pressable|Touchable)/.test((item.propertyName ?? item.name).text))) offenders.push(path)
        }
      }
    }
  }
  scan('packages/apps/mobile/app'); scan('packages/apps/mobile/src')
  expect(offenders).toEqual([])
})
test('all web apps scan the actual UI sources for shared Tailwind variants', () => {
  for (const file of ['packages/apps/webapp/src/styles.css', 'packages/apps/site/src/styles.css', 'packages/apps/docs/src/styles/app.css']) {
    const source = readFileSync(file, 'utf8').match(/@source "([^"]*libs\/ui\/src)"/)
    expect(source, file).not.toBeNull()
    expect(existsSync(resolve(dirname(file), source![1]!)), file).toBe(true)
  }
})
test('application JSX uses shared buttons, not native button elements', () => {
  const offenders: string[] = []
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules','.worktrees','dist'].includes(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) scan(path)
      else if (path.endsWith('.tsx') && /<button(?:\s|>)/.test(readFileSync(path, 'utf8'))) offenders.push(path)
    }
  }
  for (const app of readdirSync('packages/apps')) { try { scan(join('packages/apps', app, 'src')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
  expect(offenders).toEqual([])
})
