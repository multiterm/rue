import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { PermissionDecision, Tool, ToolContext, ToolResult, ToolSource } from './types.js'

/**
 * Author a tool from a Zod schema. The schema does double duty: it generates
 * the JSON Schema the model sees AND validates arguments at call time, so a
 * tool body always receives a fully-typed, already-validated input.
 */
export interface ToolSpec<Schema extends z.ZodTypeAny> {
  readonly name: string
  readonly description: string
  readonly schema: Schema
  readonly source?: ToolSource
  readonly defer?: boolean
  readonly readOnly?: boolean
  readonly searchHint?: string
  readonly checkPermissions?: (input: z.infer<Schema>, ctx: ToolContext) => PermissionDecision
  readonly call: (input: z.infer<Schema>, ctx: ToolContext) => Promise<ToolResult>
}

export function defineTool<Schema extends z.ZodTypeAny>(spec: ToolSpec<Schema>): Tool {
  const checkPermissions = spec.checkPermissions ?? (() => ({ behavior: 'allow' as const }))
  return {
    name: spec.name,
    description: spec.description,
    parameters: jsonSchemaOf(spec.schema),
    source: spec.source ?? 'builtin',
    defer: spec.defer ?? false,
    readOnly: spec.readOnly ?? false,
    searchHint: spec.searchHint,
    parseInput: raw => spec.schema.parse(raw ?? {}),
    // `parseInput` validated the value, so the cast back to the schema's type
    // is sound — the registry never calls these with anything else.
    checkPermissions: (input, ctx) => checkPermissions(input as z.infer<Schema>, ctx),
    call: (input, ctx) => spec.call(input as z.infer<Schema>, ctx)
  }
}

/** Convert a Zod schema to a bare JSON Schema object the model API accepts. */
export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>
  delete json.$schema
  return json
}
