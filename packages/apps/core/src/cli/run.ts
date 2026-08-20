import type { CommandModule } from 'yargs'
import { loadConfig } from '../config/index.js'
import { listen } from '../server/index.js'
import { seedFromEnv } from '../auth/index.js'

export interface RunArgs {
  prompt: string
  provider?: string
  model?: string
}

/**
 * `rue run "<prompt>"` — one-shot inline query.
 *
 * Boots a transient in-process server, creates a session, posts the message,
 * subscribes to the SSE event stream, and prints text deltas to stdout as
 * they arrive. Exits cleanly when the run finishes.
 *
 * Useful for scripting, CI, and "send a quick message" workflows where the
 * full TUI/web UI would be overkill.
 */
export const runCommand: CommandModule<unknown, RunArgs> = {
  command: 'run <prompt>',
  describe: 'Run a one-shot inline query',
  builder: (y) =>
    y
      .positional('prompt', {
        type: 'string',
        demandOption: true,
        describe: 'The user message to send',
      })
      .option('provider', {
        type: 'string',
        describe: 'Provider override for this run',
      })
      .option('model', {
        type: 'string',
        describe: 'Model override for this run',
      }),
  handler: async (argv) => {
    const cfg = loadConfig()
    // Force port=0 to avoid clashing with an already-running `rue serve`.
    cfg.server.port = 0
    cfg.server.hostname = '127.0.0.1'
    await seedFromEnv()
    const server = await listen({ config: cfg })

    try {
      // Create a session.
      const sessionRes = await fetch(server.url + '/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!sessionRes.ok) {
        process.stderr.write(`failed to create session: ${sessionRes.status}\n`)
        process.exit(1)
      }
      const session = (await sessionRes.json()) as { id: string }

      // Subscribe to SSE before posting so we don't miss the early events.
      const abortController = new AbortController()
      const ssePromise = subscribeAndPrint(
        server.url + '/event',
        abortController.signal,
      )

      const msgRes = await fetch(`${server.url}/session/${session.id}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: argv.prompt,
          provider: argv.provider,
          model: argv.model,
          wait: true,
        }),
      })
      if (!msgRes.ok) {
        const errText = await msgRes.text()
        process.stderr.write(`message failed: ${msgRes.status} ${errText}\n`)
        process.exit(1)
      }
      const result = (await msgRes.json()) as {
        text?: string
        stopReason?: string
      }
      // Print a trailing newline if the streamed text didn't end with one.
      process.stdout.write('\n')
      if (result.stopReason && result.stopReason !== 'completed') {
        process.stderr.write(`[stopped: ${result.stopReason}]\n`)
      }
      abortController.abort()
      await ssePromise.catch(() => {})
    } finally {
      await server.close()
      server.ctx.db.close()
    }
  },
}

/**
 * Subscribe to the SSE stream and print `part.delta` events as they arrive.
 *
 * Uses raw fetch + a manual SSE parser; the global EventSource is not
 * available in Node and adding a polyfill is overkill for this tiny CLI.
 */
async function subscribeAndPrint(url: string, signal: AbortSignal): Promise<void> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch {
    return
  }
  if (!response.ok || !response.body) return

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // Track which part we're currently printing so deltas from interleaved
  // parts don't tangle.
  let activePartId: string | null = null
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 2)
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('')
        if (!data) continue
        try {
          const evt = JSON.parse(data) as {
            type: string
            payload: {
              partId?: string
              delta?: string
              error?: string
            }
          }
          if (evt.type === 'part.delta' && evt.payload.delta) {
            if (activePartId === null) activePartId = evt.payload.partId ?? null
            if (activePartId === evt.payload.partId) {
              process.stdout.write(evt.payload.delta)
            }
          }
          if (evt.type === 'message.error') {
            process.stderr.write(`\n[error: ${evt.payload.error}]\n`)
          }
        } catch {
          // ignore malformed frames
        }
      }
    }
  } catch {
    // signal aborted, swallow
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
}
