import { describe, it, expect } from 'vitest'
import { Bus } from '../../src/bus/index.js'
import { ConfigSchema } from '../../src/config/index.js'
import { listen } from '../../src/server/index.js'
import { openDatabase } from '../../src/storage/index.js'

describe('server: listen', () => {
  it('binds, serves /health, and shuts down cleanly', async () => {
    const config = ConfigSchema.parse({ server: { hostname: '127.0.0.1', port: 0 } })
    const server = await listen({
      config,
      ctx: { db: openDatabase(':memory:'), config, bus: new Bus() },
    })
    try {
      expect(server.port).toBeGreaterThan(0)
      const res = await fetch(server.url + '/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean }
      expect(body.ok).toBe(true)
    } finally {
      await server.close()
      server.ctx.db.close()
    }
  })
})
