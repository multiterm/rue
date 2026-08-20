import { describe, it, expect } from 'vitest'
import { normalizeUrl, extractTitle, htmlToText } from '../../../src/main/capture/html.js'

describe('normalizeUrl', () => {
  it('returns https URLs unchanged', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('returns http URLs unchanged', () => {
    expect(normalizeUrl('http://example.com/path')).toBe('http://example.com/path')
  })

  it('preserves the scheme regardless of case', () => {
    expect(normalizeUrl('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM')
  })

  it('prefixes https:// when no scheme is present', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
  })

  it('trims whitespace before checking the scheme', () => {
    expect(normalizeUrl('   example.com  ')).toBe('https://example.com')
    expect(normalizeUrl('  https://example.com ')).toBe('https://example.com')
  })
})

describe('extractTitle', () => {
  it('extracts the inner text of <title>', () => {
    expect(extractTitle('<html><head><title>Hello World</title></head></html>')).toBe('Hello World')
  })

  it('handles title with attributes', () => {
    expect(extractTitle('<title data-foo="bar">Tagged</title>')).toBe('Tagged')
  })

  it('trims surrounding whitespace', () => {
    expect(extractTitle('<title>  Spaced  </title>')).toBe('Spaced')
  })

  it('returns null when no <title> is present', () => {
    expect(extractTitle('<html><body>no title</body></html>')).toBeNull()
  })

  it('returns an empty string for an empty title element', () => {
    expect(extractTitle('<title></title>')).toBe('')
  })
})

describe('htmlToText', () => {
  it('strips <script> blocks entirely', () => {
    const html = '<p>before</p><script>alert(1)</script><p>after</p>'
    const out = htmlToText(html)
    expect(out).not.toMatch(/alert/)
    expect(out).toMatch(/before/)
    expect(out).toMatch(/after/)
  })

  it('strips <style> blocks entirely', () => {
    const html = '<p>before</p><style>.x { color: red }</style><p>after</p>'
    const out = htmlToText(html)
    expect(out).not.toMatch(/color: red/)
  })

  it('strips HTML comments', () => {
    const html = '<p>hello</p><!-- secret --><p>world</p>'
    const out = htmlToText(html)
    expect(out).not.toMatch(/secret/)
  })

  it('decodes common HTML entities', () => {
    expect(htmlToText('<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</p>')).toContain(`a & b <c> "d" 'e'`)
  })

  it('replaces &nbsp; with a regular space', () => {
    expect(htmlToText('<p>a&nbsp;b</p>')).toContain('a b')
  })

  it('converts block-level tags to newlines so paragraphs separate', () => {
    const out = htmlToText('<p>line1</p><p>line2</p>')
    expect(out).toMatch(/line1[\s\S]*\n[\s\S]*line2/)
  })

  it('collapses runs of whitespace', () => {
    const out = htmlToText('<p>a   b\t\tc</p>')
    expect(out).toContain('a b c')
    expect(out).not.toContain('   ')
  })

  it('collapses 3+ newlines down to 2', () => {
    const html = '<p>a</p>\n\n\n\n<p>b</p>'
    const out = htmlToText(html)
    expect(out).not.toMatch(/\n{3,}/)
  })

  it('trims leading and trailing whitespace', () => {
    expect(htmlToText('   <p>hi</p>   ').startsWith('hi')).toBe(true)
    expect(htmlToText('   <p>hi</p>   ').endsWith('hi')).toBe(true)
  })

  it('returns an empty string for empty input', () => {
    expect(htmlToText('')).toBe('')
  })

  it('strips noscript blocks', () => {
    const html = '<noscript>enable js</noscript><p>real content</p>'
    const out = htmlToText(html)
    expect(out).not.toMatch(/enable js/)
    expect(out).toMatch(/real content/)
  })
})
