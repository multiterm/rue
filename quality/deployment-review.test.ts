import { expect, test } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

async function run(smoke: boolean, cursorAllowed = true) {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.setHeader('access-control-allow-headers', cursorAllowed ? 'authorization,last-event-id' : 'authorization')
      response.end(); return
    }
    if (request.url === '/health') response.end(JSON.stringify({ ok: true }))
    else if (request.url === '/') response.end('{}')
    else { response.statusCode = 401; response.end('{}') }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const directory = await mkdtemp(join(tmpdir(), 'rue-review-'))
  try {
    await mkdir(join(directory, '.sandblocks'))
    await writeFile(join(directory, '.sandblocks/sandbox-develop.json'), JSON.stringify({ sandboxId: 'fixture', previewUrls: ['api', 'webapp', 'site', 'docs'].map((service) => ({ service, url: `http://127.0.0.1:${address.port}` })) }))
    const env = { ...process.env }
    delete env.RUE_TEST_TOKEN; delete env.RUE_OTHER_TEST_TOKEN; delete env.RUE_TEST_ALLOW_MUTATIONS
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/review/check-deployment.mjs', import.meta.url)), 'develop', ...(smoke ? ['--smoke'] : [])], { cwd: directory, env, stdio: 'ignore' })
    const code = await new Promise<number | null>((resolve, reject) => { child.on('exit', resolve); child.on('error', reject) })
    const reportDirectory = join(directory, '.sandblocks/reports')
    const files = await readdir(reportDirectory)
    const report = JSON.parse(await readFile(join(reportDirectory, files[0]!), 'utf8'))
    return { code, report }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

test('smoke checks never claim feature completeness', async () => {
  const { code, report } = await run(true)
  expect(code).toBe(0)
  expect(report.featureComplete).toBe(false)
  expect(report.checks).toHaveLength(8)
})
test('missing authenticated-test prerequisites block feature readiness', async () => {
  const { code, report } = await run(false)
  expect(code).toBe(2)
  expect(report.checks.some((check: { status: string }) => check.status === 'blocked')).toBe(true)
})
test('an incompatible deployed reconnect endpoint fails the gate', async () => {
  const { code, report } = await run(true, false)
  expect(code).toBe(1)
  expect(report.checks.at(-1).status).toBe('failed')
})
