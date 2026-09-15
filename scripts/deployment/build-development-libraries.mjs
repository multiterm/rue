import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export function developmentBuildPayload(state) {
  if (state.environment !== 'development' || state.runtimeMode !== 'development' || !state.workerId || !state.workspaceId || !state.sandboxId || !state.sourceRevision) throw new Error('A bound development workspace is required')
  return {
    kind: 'workspace.step.run', maxAttempts: 1,
    payload: {
      workspaceId: state.workspaceId, sandboxId: state.sandboxId,
      revisionId: state.sourceRevision, runtimeType: 'development', workspaceImage: 'node:22-bookworm',
      placement: { workerId: state.workerId, ...(state.hostId ? { hostId: state.hostId } : {}), requiredWorkerRole: 'development' },
      steps: [
        { id: 'workspace-setup', command: ['corepack', 'pnpm', 'install', '--frozen-lockfile', '--config.minimumReleaseAge=0'], workingDirectory: '.', timeoutSeconds: 1800, inputs: ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'], outputs: [], required: true },
        { id: 'build-libs', command: ['corepack', 'pnpm', '--filter', './packages/libs/**', '-r', 'exec', 'rune', 'build'], workingDirectory: '.', timeoutSeconds: 600, inputs: ['package.json', 'pnpm-lock.yaml', 'packages/libs'], outputs: ['auth', 'config', 'db', 'gds', 'sdk', 'trpc', 'ui'].map((name) => `packages/libs/${name}/dist`), required: true },
      ],
    },
  }
}

/** Operator-only native-worker path; never expose the control-plane key to clients. */
export async function buildDevelopmentLibraries(root, apiUrl) {
  let state, local
  try {
    state = JSON.parse(await readFile(join(root, '.sandblocks/sandbox-development.json'), 'utf8'))
    local = parseEnv(await readFile(join(root, '.sandblocks/config.env'), 'utf8'))
  } catch { throw new Error('Protected development configuration is missing or invalid') }
  const config = { ...local, ...process.env }
  if (config.SANDBLOCKS_PROJECT_ID && config.SANDBLOCKS_PROJECT_ID !== state.projectId) throw new Error('Development project configuration does not match its workspace')
  const key = config.SANDBLOCKS_API_KEY
  const base = apiUrl ?? config.SANDBLOCKS_API_URL
  if (!key || !base) throw new Error('Operator API configuration is required')
  const body = developmentBuildPayload(state)
  const attempt = randomUUID()
  async function request(path, init = {}) {
    const response = await fetch(new URL(path, base), { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(30_000), redirect: 'error' })
    if (!response.ok) throw new Error(`Native development operation returned HTTP ${response.status}`)
    try { return await response.json() } catch { throw new Error('Native development operation returned invalid JSON') }
  }
  const submitted = await request(`/v1/projects/${encodeURIComponent(state.projectId)}/operations`, { method: 'POST', headers: { 'idempotency-key': `rue:development-build:${state.sandboxId}:${attempt}` }, body: JSON.stringify(body) })
  const id = submitted.operation?.id
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Native development operation ID is missing')
  console.log(`Native development build operation: ${id}`)
  const deadline = Date.now() + 30 * 60_000
  while (Date.now() < deadline) {
    const { operation } = await request(`/v1/operations/${id}`)
    if (operation?.state === 'succeeded') {
      if (operation.result?.passed !== true) throw new Error('Native development steps did not pass')
      return
    }
    if (['failed', 'cancelled', 'canceled'].includes(operation?.state)) throw new Error(`Native development build ${id} failed; inspect its protected operation logs`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Native development build ${id} is still unresolved; reconcile it before retrying`)
}
