import { z } from 'zod'

/**
 * Top-level rue.json schema.
 *
 * All fields are optional. Defaults are applied at load time.
 *
 * Per-phase additions:
 *  - Phase 1: provider, model, server, paths
 *  - Phase 2: providers (per-provider options), prompts
 *  - Phase 3: tools (built-in tool overrides), permission rules
 *  - Phase 4: mcp, notebooks, memory, skills
 */
export const ProviderIdSchema = z.enum(['anthropic', 'openrouter', 'ollama'])
export type ProviderId = z.infer<typeof ProviderIdSchema>

export const ServerConfigSchema = z
  .object({
    hostname: z.string().default('127.0.0.1'),
    port: z.number().int().min(0).max(65535).default(4097),
    /** When set, server requires `Authorization: Basic <base64>` matching `password`. */
    password: z.string().optional(),
  })
  .default({ hostname: '127.0.0.1', port: 4097 })

export const KeynameConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    apiUrl: z.string().url().default('https://api.keyname.dev'),
    /** Optional OAuth audience for registered confidential/public clients. */
    clientId: z.string().min(1).optional(),
  })
  .default({ enabled: false, apiUrl: 'https://api.keyname.dev' })

export const ConfigSchema = z
  .object({
    /** Default provider for new sessions. */
    provider: ProviderIdSchema.default('openrouter'),
    /** Default model slug, provider-specific. */
    model: z.string().default('anthropic/claude-sonnet-4'),
    /** Built-in system prompt addendum. */
    systemPrompt: z.string().optional(),
    /** HTTP server settings. */
    server: ServerConfigSchema,
    /** Shared Keyname identity settings for every Rue surface. */
    keyname: KeynameConfigSchema,
    /** Token budget before compaction kicks in. */
    tokenBudget: z.number().int().positive().default(120_000),
    /** Maximum tool-use turns per query before forced stop. */
    maxTurns: z.number().int().positive().default(8),
    /** Debug mode — enables JSONL debug log + protected-files guardrails. */
    debug: z.boolean().default(false),
  })
  .strict()

export type Config = z.infer<typeof ConfigSchema>
/** A partial config as found on disk before merging. */
export const PartialConfigSchema = ConfigSchema.partial()
export type PartialConfig = z.infer<typeof PartialConfigSchema>
