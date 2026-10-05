import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { appendPart } from './messages.js'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_MESSAGE_BYTES = 20 * 1024 * 1024
import {AttachmentError,MAX_ATTACHMENT_STORAGE_BYTES,ATTACHMENT_STORAGE_FULL,type MessageContent} from '@multiterm/rue-db'
export {AttachmentError,type MessageContent}

// Do not let a supplied MIME type turn HTML/SVG into active preview content.
function mediaType(bytes: Buffer, supplied: string) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg'
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (bytes.subarray(4, 8).toString() === 'ftyp' && ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'].includes(bytes.subarray(8, 12).toString())) return 'video/mp4'
  if (bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) && supplied === 'video/webm') return 'video/webm'
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if ((supplied.startsWith('text/') || supplied === 'application/json') && !bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes)) return 'text/plain'
  return 'application/octet-stream'
}
export function validateContent(content: MessageContent[] | undefined): MessageContent[] | undefined {
  if (!content) return undefined
  let total = 0, files = 0, textLength = 0
  const result = content.map(part => {
    if (part.type === 'text') {
      textLength += part.text.length
      if (textLength > 100_000) throw new AttachmentError('Message text is too long.')
      return part
    }
    if (++files > 8 || part.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || (part.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(part.data))) throw new AttachmentError('Invalid attachment. Use up to 8 files, at most 10 MB each.')
    const bytes = Buffer.from(part.data, 'base64')
    total += bytes.length
    if (bytes.length > MAX_FILE_BYTES || total > MAX_MESSAGE_BYTES) throw new AttachmentError('Attachments exceed the 10 MB/file or 20 MB/message limit.')
    return { type: 'file' as const, name: part.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200) || 'attachment', mimeType: mediaType(bytes, part.mimeType), data: bytes.toString('base64'), size: bytes.length }
  })
  if (!files) throw new AttachmentError('Attachment content must contain a file.')
  return result
}
export function contentSummary(content: MessageContent[]) {
  return content.map(p => p.type === 'text' ? p.text : `[Attachment: ${p.name}]`).join('')
}
export function checkAttachmentBudget(db: Database, owner: string, content?: MessageContent[]) {
  if (!content) return
  const used = db.prepare("SELECT coalesce(sum(length(p.payload)),0) AS size FROM parts p JOIN sessions s ON s.id=p.session_id WHERE p.type='file' AND s.owner_subject=?").get(owner) as { size: number }
  if (used.size + JSON.stringify(content).length > MAX_ATTACHMENT_STORAGE_BYTES) throw new AttachmentError(ATTACHMENT_STORAGE_FULL)
}
export function appendContent(db: Database, sessionId: string, messageId: string, content: MessageContent[]) {
  for (const part of content) {
    const { type, ...payload } = part
    appendPart(db, { id: `part_${randomUUID()}`, sessionId, messageId, type, payload })
  }
}
