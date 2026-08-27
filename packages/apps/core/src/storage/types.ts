/**
 * Domain types for the persisted state. These mirror the wire format the
 * server exposes; Phase 2 adds the LLM-facing translations.
 */

export type Role = 'user' | 'assistant' | 'system'

export type PartType =
  | 'text'
  | 'reasoning'
  | 'tool'
  | 'file'
  | 'step-start'
  | 'step-finish'
  | 'patch'
  | 'snapshot'
  | 'compaction'
  | 'agent'
  | 'subtask'
  | 'retry'
  | 'error'

export interface SessionRow {
  id: string
  title: string
  agent: string | null
  provider: string | null
  model: string | null
  directory: string | null
  scopes: string[]
  parentId: string | null
  ownerSubject: string
  createdAt: number
  updatedAt: number
  meta: Record<string, unknown>
}

export interface MessageRow {
  id: string
  sessionId: string
  role: Role
  time: number
  provider: string | null
  model: string | null
  agent: string | null
  meta: Record<string, unknown>
  seq: number
}

export interface PartRow {
  id: string
  sessionId: string
  messageId: string
  type: PartType
  seq: number
  payload: Record<string, unknown>
}

export interface NotebookRow {
  id: number
  name: string
  path: string
  updatedAt: number
}

export interface ScheduledTaskRow {
  id: string
  prompt: string
  whenMs: number
  recurringMs: number | null
  sessionId: string | null
  meta: Record<string, unknown>
}

/** -1 = thumbs down, 0 = none/reset, 1 = thumbs up. */
export type Rating = -1 | 0 | 1
