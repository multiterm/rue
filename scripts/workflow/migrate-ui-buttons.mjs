import ts from 'typescript'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Mechanical JSX migration: retain handlers, refs, labels and layout classes.
// Run from the repository root. Only app source files are eligible.
const apply = process.argv.includes('--apply')
function visitDirectory(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.worktrees', 'dist'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { visitDirectory(path); continue }
    if (!path.endsWith('.tsx') || path === 'packages/libs/ui/src/button/index.tsx') continue
    const source = readFileSync(path, 'utf8'), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), edits = []
    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxClosingElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'button') {
        edits.push({ start: node.tagName.getStart(ast), end: node.tagName.end, text: ts.isJsxClosingElement(node) ? 'Button' : 'Button variant="bare"' })
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    if (!edits.length) continue
    const moduleName = path.startsWith('packages/libs/ui/') ? '../button/index.js' : '@multiterm/rue-ui'
    const imported = ast.statements.find(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === moduleName && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings))
    if (imported) {
      const bindings = imported.importClause.namedBindings
      if (!bindings.elements.some(item => item.name.text === 'Button')) edits.push({ start: bindings.getStart(ast) + 1, end: bindings.getStart(ast) + 1, text: 'Button,' })
    } else edits.push({ start: 0, end: 0, text: `import { Button } from '${moduleName}'\n` })
    let result = source
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
    console.log(`${apply ? 'updated' : 'would update'} ${path}`)
    if (apply) writeFileSync(path, result)
  }
}
if (process.argv.includes('--ui')) visitDirectory('packages/libs/ui/src')
for (const app of readdirSync('packages/apps', { withFileTypes: true }).filter(entry => entry.isDirectory())) {
  const src = join('packages/apps', app.name, 'src')
  try { visitDirectory(src) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
