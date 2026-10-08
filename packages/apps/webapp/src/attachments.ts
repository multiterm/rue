import type { RueMessageContent } from '@multiterm/rue-sdk'
export interface DraftFile { id: string; name: string; mimeType: string; data: string; size: number }
export const fileToken = (id: string) => `[[file:${id}]]`
export const tokenPattern = () => /\[\[file:([a-f0-9-]+)\]\]/g
export function messageContent(text: string, files: DraftFile[]): RueMessageContent[] | undefined {
  const content: RueMessageContent[] = []
  let offset = 0, count = 0
  for (const match of text.matchAll(tokenPattern())) {
    if (match.index! > offset) content.push({ type: 'text', text: text.slice(offset, match.index) })
    const file = files.find(f => f.id === match[1])
    if (!file) throw new Error('An attachment is missing. Remove its placeholder and attach the file again.')
    content.push({ type: 'file', name: file.name, mimeType: file.mimeType, data: file.data }); count++
    offset = match.index! + match[0].length
  }
  if (!count) return undefined
  if (count > 8) throw new Error('Attach at most 8 files.')
  if (offset < text.length) content.push({ type: 'text', text: text.slice(offset) })
  return content
}
export async function readFiles(files: File[], existing: DraftFile[]): Promise<DraftFile[]> {
  if (files.length + existing.length > 8) throw new Error('Attach at most 8 files.')
  if (files.some(f => f.size > 10 * 1024 * 1024)) throw new Error('Each attachment must be 10 MB or smaller.')
  if ([...files, ...existing].reduce((size, file) => size + file.size, 0) > 20 * 1024 * 1024) throw new Error('Attachments must total 20 MB or less.')
  return Promise.all(files.map(async file => ({ id: crypto.randomUUID(), name: file.name.slice(0, 200) || 'attachment', mimeType: file.type || 'application/octet-stream', size: file.size, data: await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.onabort = () => reject(new Error('File reading cancelled.'))
    reader.readAsDataURL(file)
  }) })))
}
export const previewImage = (type: string) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)
export const previewVideo = (type: string) => ['video/mp4', 'video/webm'].includes(type)
