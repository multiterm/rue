import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { getProvider } from '../../provider/index.js'
import { runQuery } from '../../session/index.js'
import { appendMessage, appendPart, getSession } from '../../storage/index.js'
import { getAuthBackend } from '../../auth/index.js'
import type { ServerContext } from '../context.js'

/* ---------- schemas ---------- */

const SendMessageRequestSchema = z
  .object({
    text: z.string().min(1, 'text must be non-empty'),
    /** Per-message provider override. */
    provider: z.string().optional(),
    /** Per-message model override. */
    model: z.string().optional(),
    /** Per-message system prompt addendum. */
    systemPrompt: z.string().optional(),
    /** If true, run synchronously and wait for completion before responding. */
    wait: z.boolean().optional(),
  })
  .openapi('SendMessageRequest')

const SendMessageResponseSchema = z
  .object({
    userMessageId: z.string(),
    assistantMessageId: z.string(),
    /** Present only when `wait=true`. */
    text: z.string().optional(),
    stopReason: z.string().optional(),
  })
  .openapi('SendMessageResponse')

const ErrorSchema = z.object({ error: z.string() }).openapi('Error')

/* ---------- handler ---------- */

function generateId(prefix: string): string {
  const rand =
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return `${prefix}_${rand.slice(0, 24)}`
}

/**
 * POST /session/:id/message
 *
 * Append a user message + text part, kick off the assistant run, and return
 * IDs. When `wait=true`, block until the run finishes and include the final
 * assistant text in the response.
 *
 * Streaming output is delivered separately via `GET /event` (SSE): subscribe
 * before posting and you will see `part.delta` events arrive in real time.
 */
export function messageRoutes(): OpenAPIHono<{ Variables: { ctx: ServerContext } }> {
  const app = new OpenAPIHono<{ Variables: { ctx: ServerContext } }>()

  app.openapi(
    createRoute({
      method: 'post',
      path: '/session/{id}/message',
      tags: ['session', 'message'],
      request: {
        params: z.object({
          id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
        }),
        body: {
          content: { 'application/json': { schema: SendMessageRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          description: 'Message dispatched',
          content: { 'application/json': { schema: SendMessageResponseSchema } },
        },
        404: {
          description: 'Session not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        400: {
          description: 'Bad request',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { ctx } = c.var
      const { id: sessionId } = c.req.valid('param')
      const body = c.req.valid('json')

      const session = getSession(ctx.db, sessionId)
      if (!session) return c.json({ error: 'session_not_found' }, 404)

      const providerId = body.provider ?? session.provider ?? ctx.config.provider
      const model = body.model ?? session.model ?? ctx.config.model
      const provider = getProvider(providerId)
      if (!provider) {
        return c.json({ error: `unknown_provider:${providerId}` }, 400)
      }
      const apiKey = (await getAuthBackend().get(providerId)) ?? ''
      // Ollama uses apiKey as base URL; allow empty for default localhost.
      if (!apiKey && providerId !== 'ollama') {
        return c.json({ error: `no_credentials_for:${providerId}` }, 400)
      }

      // Persist the user message + text part synchronously.
      const userMessageId = generateId('msg')
      appendMessage(ctx.db, {
        id: userMessageId,
        sessionId,
        role: 'user',
      })
      appendPart(ctx.db, {
        id: generateId('txt'),
        sessionId,
        messageId: userMessageId,
        type: 'text',
        payload: { text: body.text },
      })
      ctx.bus.publish('message.created', {
        sessionId,
        messageId: userMessageId,
        role: 'user',
        text: body.text,
      })

      // Create the assistant message shell.
      const assistantMessageId = generateId('msg')
      appendMessage(ctx.db, {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        provider: providerId,
        model,
      })

      const runPromise = runQuery({
        db: ctx.db,
        bus: ctx.bus,
        sessionId,
        messageId: assistantMessageId,
        provider,
        model,
        apiKey,
        systemPrompt: body.systemPrompt ?? ctx.config.systemPrompt,
        tokenBudget: ctx.config.tokenBudget,
        maxTurns: ctx.config.maxTurns,
      })

      if (body.wait) {
        const result = await runPromise
        return c.json(
          {
            userMessageId,
            assistantMessageId,
            text: result.text,
            stopReason: result.stopReason,
          },
          200,
        )
      }

      // Fire-and-forget. Caller subscribes to SSE for progress.
      runPromise.catch((err) => {
        // The runQuery loop converts errors to error parts internally; this
        // catch is only for genuine programming errors.
        // eslint-disable-next-line no-console
        console.error('[runQuery] unexpected throw:', err)
      })

      return c.json({ userMessageId, assistantMessageId }, 200)
    },
  )

  return app
}
