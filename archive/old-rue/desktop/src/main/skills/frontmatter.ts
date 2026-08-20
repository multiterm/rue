/**
 * A minimal YAML-frontmatter parser for `SKILL.md` files. It deliberately
 * supports only what skill frontmatter needs — `key: value` scalars and
 * `key: [a, b]` inline arrays — so there's no YAML dependency.
 */

export interface ParsedFrontmatter {
  readonly fields: Readonly<Record<string, string | ReadonlyArray<string>>>
  readonly body: string
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = raw.replace(/\r\n/g, '\n')
  const match = FRONTMATTER.exec(normalized)
  if (!match) return { fields: {}, body: normalized.trim() }

  const fields: Record<string, string | ReadonlyArray<string>> = {}
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    fields[key] = parseValue(trimmed.slice(idx + 1).trim())
  }
  return { fields, body: normalized.slice(match[0].length).trim() }
}

function parseValue(value: string): string | ReadonlyArray<string> {
  const unquoted = stripQuotes(value)
  if (unquoted.startsWith('[') && unquoted.endsWith(']')) {
    return unquoted
      .slice(1, -1)
      .split(',')
      .map(part => stripQuotes(part.trim()))
      .filter(Boolean)
  }
  return unquoted
}

function stripQuotes(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  return quoted ? value.slice(1, -1) : value
}
