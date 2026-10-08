export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'file'; name: string; mimeType: string; data: string; size?: number }

export class AttachmentError extends Error {}
export const MAX_ATTACHMENT_STORAGE_BYTES = 140 * 1024 * 1024
export const ATTACHMENT_STORAGE_FULL = 'Attachment storage is full (100 MB). Delete old conversations to free space.'
