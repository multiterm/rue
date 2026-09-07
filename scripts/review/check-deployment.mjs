#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const environment = process.argv[2]
if (!['develop', 'preview'].includes(environment)) throw new Error('Use develop or preview; production is not permitted by this review runner')
const smoke = process.argv.includes('--smoke')
let state
try { state = JSON.parse(await readFile(`.sandblocks/sandbox-${environment}.json`, 'utf8')) }
catch { throw new Error('Deployment state is missing or invalid; its secret-bearing contents are not logged') }
if (!Array.isArray(state.previewUrls)) throw new Error('Deploy the sandbox before running its readiness checks')
const urls = Object.fromEntries(state.previewUrls.map(({ service, url }) => [service, url]))
const checks = []
class CheckFailure extends Error {}
async function check(name, fn) {
  try { await fn(); checks.push({ name, status: 'passed' }) }
  catch (error) { checks.push({ name, status: 'failed', error: error instanceof CheckFailure ? error.message : 'Request failed or returned invalid JSON' }) }
}
function assert(condition, message) { if (!condition) throw new CheckFailure(message) }
async function request(service, path, init = {}) {
  assert(typeof urls[service] === 'string', `Missing ${service} URL`)
  return fetch(new URL(path, urls[service]), { ...init, signal: AbortSignal.timeout(15_000), redirect: 'manual' })
}
for (const service of ['api', 'webapp', 'site', 'docs']) {
  await check(`${service}: public health`, async () => {
    const response = await request(service, service === 'api' ? '/health' : '/')
    assert(response.status === 200, `HTTP ${response.status}`)
    if (service === 'api') assert((await response.json()).ok === true, 'API health contract failed')
  })
}
for (const path of ['/session', '/device', '/sync/preferences']) {
  await check(`api: unauthenticated ${path}`, async () => {
    const response = await request('api', path)
    assert(response.status === 401, `Expected 401; got ${response.status}`)
  })
}
await check('api: browser reconnect preflight', async () => {
  const response = await request('api', '/event', { method: 'OPTIONS', headers: {
    origin: urls.webapp, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,last-event-id',
  } })
  assert(response.ok && response.headers.get('access-control-allow-headers')?.toLowerCase().includes('last-event-id'), 'SSE cursor preflight rejected')
})

const token = process.env.RUE_TEST_TOKEN
if (!smoke && (!token || process.env.RUE_TEST_ALLOW_MUTATIONS !== '1')) {
  checks.push({ name: 'authenticated feature scenarios', status: 'blocked', error: 'Provide a dedicated RUE_TEST_TOKEN and RUE_TEST_ALLOW_MUTATIONS=1; never use a personal production session.' })
} else if (!smoke) {
  const run = randomUUID()
  const sessionIds = []
  const deviceIds = []
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const api = (path, method = 'GET', body) => request('api', path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    await check('api: create, read across clients, update session', async () => {
      const created = await api('/session', 'POST', { title: `review-${run}` })
      assert(created.ok, `Create returned ${created.status}`)
      const session = await created.json(); assert(typeof session.id === 'string', 'Session ID missing'); sessionIds.push(session.id)
      const otherClient = await request('api', `/session/${session.id}`, { headers: { authorization: `Bearer ${token}` } })
      assert(otherClient.ok && (await otherClient.json()).title === `review-${run}`, 'Second client did not observe persisted session')
      const patched = await api(`/session/${session.id}`, 'PATCH', { title: `review-updated-${run}` })
      assert(patched.ok, `Update returned ${patched.status}`)
      const read = await api(`/session/${session.id}`)
      assert((await read.json()).title === `review-updated-${run}`, 'Update not persisted')
    })
    await check('api: one-time pairing', async () => {
      const source = { deviceId: `review-source-${run}`, name: 'Isolated review source', platform: 'web' }
      const target = { deviceId: `review-target-${run}`, name: 'Isolated review target', platform: 'android' }
      deviceIds.push(source.deviceId, target.deviceId)
      const created = await api('/pairing', 'POST', source)
      assert(created.ok, `Pairing returned ${created.status}`)
      const pair = await created.json()
      const redeemed = await api('/pairing/redeem', 'POST', { ...target, token: pair.token })
      assert(redeemed.ok, `Redeem returned ${redeemed.status}`)
      const duplicate = await api('/pairing/redeem', 'POST', { ...target, token: pair.token })
      assert(duplicate.status === 410, 'Pairing token accepted twice')
    })
    if (process.env.RUE_OTHER_TEST_TOKEN && sessionIds[0]) {
      await check('api: cross-owner session isolation', async () => {
        const response = await request('api', `/session/${sessionIds[0]}`, { headers: { authorization: `Bearer ${process.env.RUE_OTHER_TEST_TOKEN}` } })
        assert(response.status === 404 || response.status === 403, `Other owner received ${response.status}`)
      })
    } else checks.push({ name: 'api: cross-owner session isolation', status: 'blocked', error: 'A second dedicated test identity is required' })
    checks.push({ name: 'remote agent execution / deployment / self-update', status: 'blocked', error: 'Not implemented; chat CRUD and pairing are not remote execution proof' })
  } finally {
    for (const id of sessionIds) await check('cleanup: test session', async () => { assert((await api(`/session/${id}`, 'DELETE')).ok, 'Session cleanup failed') })
    for (const id of deviceIds) await check('cleanup: test device', async () => { assert((await api(`/device/${id}`, 'DELETE')).ok, 'Device cleanup failed') })
  }
}
const report = { environment, sandboxId: state.sandboxId, recordedDeploymentId: state.deploymentId, checkedAt: new Date().toISOString(), mode: smoke ? 'smoke' : 'features', featureComplete: false, checks }
await mkdir('.sandblocks/reports', { recursive: true, mode: 0o700 })
const reportPath = `.sandblocks/reports/review-${environment}-${Date.now()}.json`
await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
for (const { name, status, error } of checks) console.log(`${status.toUpperCase()} ${name}${error ? `: ${error}` : ''}`)
console.log(`Report: ${reportPath}; smoke success is not feature completeness.`)
process.exitCode = checks.some((check) => check.status === 'failed') ? 1 : checks.some((check) => check.status === 'blocked') ? 2 : 0
