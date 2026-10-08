import {ConversationError,RelayError} from '@multiterm/rue-db/postgres'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { randomBytes } from 'node:crypto'
import { piProvider } from '../../provider/pi.js'
import { getProvider } from '../../provider/index.js'
import { runQuery } from '../../session/index.js'
import {sessionServices} from '../session-services.js'
import { getAuthBackend } from '../../auth/index.js'
import type { ServerContext } from '../context.js'

import { AttachmentError, validateContent, contentSummary, type MessageContent } from '../../storage/attachments.js'

/* ---------- schemas ---------- */

const SendMessageRequestSchema = z
  .object({
    text: z.string().min(1, 'text must be non-empty').max(100_000),
    content: z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), text: z.string().max(100_000) }),
      z.object({ type: z.literal('file'), name: z.string().min(1).max(200), mimeType: z.string().max(100), data: z.string().max(14_000_000) }),
    ])).min(1).max(32).optional(),
    /** Per-message provider override. */
    provider: z.string().optional(),
    /** Per-message model override. */
    model: z.string().optional(),
    /** Per-message system prompt addendum. */
    systemPrompt: z.string().max(100_000).optional(),
    /** If true, run synchronously and wait for completion before responding. */
    wait: z.boolean().optional(),
    requestId: z.string().uuid().optional(),
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

function reserveRun(ctx: ServerContext, subject: string): (() => void) | undefined {
  const active = ctx.activeRuns ??= new Map<string, number>()
  const count = active.get(subject) ?? 0
  if (count >= 3 || ctx.historyResets?.has(subject)) return undefined
  active.set(subject, count + 1)
  return () => {
    const next = (active.get(subject) ?? 1) - 1
    if (next <= 0) active.delete(subject)
    else active.set(subject, next)
  }
}

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString('base64url')}`
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
export function messageRoutes(terminalEnabled = false): OpenAPIHono<{ Variables: { ctx: ServerContext } }> {
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
        503: {
          description: 'Agent credential storage unavailable',
          content: { 'application/json': { schema: ErrorSchema } },
        },
        429: {
          description: 'Too many active runs',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { ctx } = c.var
      const { id: sessionId } = c.req.valid('param')
      const body = c.req.valid('json')

      const owner=c.get('principal').subject,store=sessionServices(ctx)
      const session = await store.conversations.get(owner,sessionId)
      if (!session) return c.json({ error: 'session_not_found' }, 404)

      let content: MessageContent[] | undefined
      try { content = validateContent(body.content) }
      catch (error) { return c.json({ error: error instanceof AttachmentError ? error.message : 'Invalid attachments' }, 400) }
      const text = content ? contentSummary(content) : body.text

      // Fail closed even if mutable session metadata has been edited. A linked
      // terminal must never fall back to the owner's configured cloud provider.
      if (session.terminalConnectionId || session.agent === 'pi-terminal' || session.meta.terminalConnectionId) {
        if (!terminalEnabled || !body.requestId) return c.json({ error: 'terminal_transport_unavailable' }, 503)
        try {
          const queued = await store.relay.enqueue(owner, sessionId, body.requestId, text, undefined, content)
          ctx.bus.publish('message.created', { ownerSubject:owner, sessionId, messageId: queued.user_message_id })
          ctx.bus.publish('terminal.command.queued', { ownerSubject:owner, sessionId })
          return c.json({ userMessageId: queued.user_message_id, assistantMessageId: queued.assistant_message_id, stopReason: queued.status }, 200)
        } catch (error) {
          if (error instanceof AttachmentError) return c.json({ error: error.message }, 400)
          return c.json({ error: error instanceof RelayError ? error.code : 'terminal_transport_unavailable' }, 503)
        }
      }

      const settings = await store.settings.get(owner)
      const configured = settings.revision > 0
      const providerId = configured ? settings.provider : body.provider ?? session.provider ?? ctx.config.provider
      const model = configured ? settings.model : body.model ?? session.model ?? ctx.config.model
      const provider = configured ? piProvider : getProvider(providerId)
      if (!provider) {
        return c.json({ error: `unknown_provider:${providerId}` }, 400)
      }
      let apiKey: string
      try { apiKey = (configured ? await store.settings.apiKey(owner) : await getAuthBackend().get(providerId)) ?? '' }
      catch { return c.json({ error: 'agent_key_storage_unavailable' }, 503) }
      // Ollama uses apiKey as base URL; allow empty for default localhost.
      if (!apiKey && providerId !== 'ollama') {
        return c.json({ error: `no_credentials_for:${providerId}` }, 400)
      }

      const releaseRun = reserveRun(ctx, owner)
      if (!releaseRun) return c.json({ error: 'too_many_active_runs' }, 429)

      // Recheck remote authority and atomically persist both message shells,
      // content and quota admission. Never leak an admission slot on failure.
      const userMessageId=generateId('msg'),assistantMessageId=generateId('msg')
      try {
        await store.conversations.beginCloud(owner,{sessionId,userMessageId,assistantMessageId,textPartId:generateId('txt'),text:body.text,content,provider:providerId,model})
      } catch(error) {
        releaseRun()
        if(error instanceof AttachmentError)return c.json({error:error.message},400)
        if(error instanceof ConversationError&&error.status===404)return c.json({error:error.code},404)
        return c.json({error:error instanceof ConversationError?error.code:'conversation_storage_unavailable'},503)
      }
      ctx.bus.publish('message.created',{ownerSubject:owner,sessionId,messageId:userMessageId,role:'user',text:body.text})

      const runPromise = runQuery({
        services: store,
        ownerSubject: owner,
        bus: ctx.bus,
        sessionId,
        messageId: assistantMessageId,
        provider,
        model,
        apiKey,
        systemPrompt: configured ? [settings.systemPrompt, typeof session.meta.description === 'string' ? session.meta.description : '', body.systemPrompt ?? ''].filter(Boolean).join('\n\n') : body.systemPrompt ?? ctx.config.systemPrompt,
        tokenBudget: ctx.config.tokenBudget,
        maxTurns: ctx.config.maxTurns,
      }).then(async result=>{
        await store.notifyCompletion(owner,sessionId,`cloud:${assistantMessageId}`,result.stopReason==='completed'?'task_completed':'task_failed')
        return result
      }).finally(releaseRun)

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
      runPromise.catch(() => {
        // The runQuery loop converts errors to error parts internally; this
        // catch is only for genuine programming errors.
        // eslint-disable-next-line no-console
        console.error('[runQuery] execution or completion persistence failed')
      })

      return c.json({ userMessageId, assistantMessageId }, 200)
    },
  )

  return app
}
