import { useState } from 'react'
import {Button, CopyButton } from '@multiterm/rue-ui'
import './tool-message.css'

export interface ToolTranscript { name: string; status: string; args: string; output: string; diff: string; raw: string }
// Read only the bridge's fenced format. Fence length is dynamic so tool output
// containing Markdown/backticks cannot escape its section.
export function parseToolTranscript(text: string): ToolTranscript | undefined {
  const header = /^### Tool: ([\w.-]+) — (running|completed|failed|interrupted)\n/.exec(text)
  const legacy = /^Tool output: ([\w.-]+)( \(error\))?\n/.exec(text)
  if (!header && !legacy) return
  const sections: Record<string, string> = {}
  const lines = text.split('\n')
  let section = legacy ? 'Output' : ''
  for (let i = 1; i < lines.length; i++) {
    const label = /^\*\*(Arguments|Output|Diff)\*\*$/.exec(lines[i]!)
    if (label) { section = label[1]!; continue }
    const fence = /^(`{3,})(?:\w*)$/.exec(lines[i]!)
    if (!section || !fence) continue
    const body: string[] = []
    while (++i < lines.length && lines[i] !== fence[1]) body.push(lines[i]!)
    sections[section] = body.join('\n'); section = ''
  }
  return { name: (header ?? legacy)![1]!, status: header?.[2] ?? (legacy?.[2] ? 'failed' : 'completed'), args: sections.Arguments ?? '', output: sections.Output ?? '', diff: sections.Diff ?? '', raw: text }
}
export function ToolMessage({ tool, kind = 'tool' }: { tool: ToolTranscript; kind?: 'tool' | 'thinking' }) {
  const [expanded, setExpanded] = useState(false)
  let target = ''
  try { const args = JSON.parse(tool.args); target = String(args.path ?? args.file_path ?? args.command ?? args.pattern ?? '') } catch { /* Incomplete streaming arguments remain available below. */ }
  const source = tool.diff || tool.output || tool.args || tool.raw
  const lines = source.split('\n')
  const preview = lines.slice(0, 5).map(line => line.length > 140 ? line.slice(0, 140) + '…' : line).join('\n')
  const clipped = lines.length > 5 || lines.some(line => line.length > 140)
  return <section className={`tool-card ${kind === 'thinking' ? 'thinking-card' : ''} ${expanded ? 'expanded' : ''}`} data-status={tool.status} aria-label={kind === 'thinking' ? 'Agent thinking' : `${tool.name} tool`}>
    <Button variant="bare" type="button" className="tool-card-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span><strong>{tool.name}</strong><span className="tool-card-target" title={target}>{target.slice(0, 200)}</span><span className="tool-card-status">{tool.status}</span>
    </Button>
    {!expanded ? <Button variant="bare" type="button" className="tool-card-preview" aria-label={kind === 'thinking' ? 'Expand thinking' : `Expand ${tool.name} tool details`} onClick={() => setExpanded(true)}><pre>{preview}</pre><span className="tool-card-hint">{clipped ? 'Preview shortened · ' : ''}Click to expand full details</span></Button> : <div className="tool-card-details">
      {([['Arguments', tool.args], [kind === 'thinking' ? 'Exposed reasoning' : 'Output', tool.output], ['Diff', tool.diff]] as const).filter(([, text]) => text).map(([label, text]) => <section key={label}><header><strong>{label}</strong><CopyButton text={text}/></header><pre>{text}</pre></section>)}
      {!tool.args && !tool.output && !tool.diff && <pre>{tool.raw}</pre>}
      <Button variant="bare" type="button" className="tool-card-collapse" onClick={() => setExpanded(false)}>Collapse details</Button>
    </div>}
  </section>
}
