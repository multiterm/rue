import { expect, test, vi } from 'vitest'
import { syncDevelopment } from '../scripts/deployment/sync-development.mjs'
import { developmentBuildPayload } from '../scripts/deployment/build-development-libraries.mjs'

test('development checks run only after native-worker dependencies and libraries are refreshed', async () => {
  const order: string[] = []
  const run = vi.fn(async (args: string[]) => { order.push(args[1]!) })
  const build = vi.fn(async () => { order.push('native-build') })
  await syncDevelopment(run, '/fixture', 'https://api.sandblocks.dev', build)
  expect(order).toEqual(['sync', 'native-build', 'check'])
  expect(run.mock.calls[0]![0]).toContain('none')
  expect(run.mock.calls[1]![0]).toContain('full')
  expect(build).toHaveBeenCalledWith('/fixture', 'https://api.sandblocks.dev')
  for (const [command] of run.mock.calls) expect(command).toContain('develop')
})
test('failed native build prevents deployment checks', async () => {
  const run = vi.fn(async () => {})
  const build = vi.fn().mockRejectedValue(new Error('Install failed'))
  await expect(syncDevelopment(run, '/fixture', undefined, build)).rejects.toThrow('Install failed')
  expect(run).toHaveBeenCalledTimes(1)
})
test('native build is explicitly worker-bound and uses frozen dependency installation', () => {
  const request = developmentBuildPayload({ environment: 'develop', runtimeMode: 'development', workerId: 'worker', workspaceId: 'workspace', sandboxId: 'sandbox', sourceRevision: 'revision' })
  expect(request.kind).toBe('workspace.step.run')
  expect(request.payload.placement).toEqual({ workerId: 'worker', requiredWorkerRole: 'development' })
  expect(request.payload.steps[0].command).toContain('--frozen-lockfile')
  expect(request.payload.steps[1].outputs).toContain('packages/libs/sdk/dist')
})
test.each(['preview', 'production'])('native build refuses %s state', (environment) => {
  expect(() => developmentBuildPayload({ environment, runtimeMode: 'development' })).toThrow('bound development workspace')
})
