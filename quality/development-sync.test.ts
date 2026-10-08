import { expect, test, vi } from 'vitest'
import { syncDevelopment, assertDevelopmentQualityState } from '../scripts/deployment/sync-development.mjs'
import { developmentBuildPayload } from '../scripts/deployment/build-development-libraries.mjs'

test('development checks run only after native-worker dependencies and libraries are refreshed', async () => {
  const order: string[] = []
  const run = vi.fn(async (args: string[]) => { order.push(args[1]!) })
  const build = vi.fn(async () => { order.push('native-build') })
  const verify = vi.fn(async () => { order.push('verify') })
  await syncDevelopment(run, '/fixture', 'https://api.sandblocks.dev', build, async () => {}, verify)
  expect(order).toEqual(['sync', 'native-build', 'check', 'verify'])
  expect(verify).toHaveBeenCalledWith('/fixture')
  expect(run.mock.calls[0]![0]).toContain('none')
  expect(run.mock.calls[1]![0]).toContain('full')
  expect(build).toHaveBeenCalledWith('/fixture', 'https://api.sandblocks.dev')
  for (const [command] of run.mock.calls) expect(command).toContain('development')
})
test('failed native build prevents deployment checks', async () => {
  const run = vi.fn(async () => {})
  const build = vi.fn().mockRejectedValue(new Error('Install failed'))
  await expect(syncDevelopment(run, '/fixture', undefined, build, async () => {})).rejects.toThrow('Install failed')
  expect(run).toHaveBeenCalledTimes(1)
})
test('sync rejects recorded check failures even when every CLI command exits zero', async () => {
  const run = vi.fn(async () => {})
  await expect(syncDevelopment(run, '/fixture', undefined, async () => {}, async () => {},
    async () => { throw new Error('Recorded checks failed') })).rejects.toThrow('Recorded checks failed')
  expect(run).toHaveBeenCalledTimes(2)
})
test('quality acceptance is bound to successful checks of the current development revision', () => {
  const passed = {
    environment: 'development', runtimeMode: 'development', sourceRevision: 'revision',
    quality: { sourceRevision: 'revision', status: 'passed', checks: [
      { sourceRevision: 'revision', status: 'passed', required: true },
    ] },
  }
  expect(() => assertDevelopmentQualityState(passed)).not.toThrow()
  for (const patch of [
    { environment: 'preview' }, { runtimeMode: 'immutable' }, { sourceRevision: '' },
    { sourceRevision: 'newer' }, { quality: undefined },
    { quality: { ...passed.quality, status: 'failed' } },
    { quality: { ...passed.quality, checks: [] } },
    { quality: { ...passed.quality, checks: [null] } },
    { quality: { ...passed.quality, checks: [{ sourceRevision: 'older', status: 'passed' }] } },
    { quality: { ...passed.quality, checks: [{ sourceRevision: 'revision', status: 'failed' }] } },
  ]) expect(() => assertDevelopmentQualityState({ ...passed, ...patch })).toThrow('current source revision')
})
test('native build is explicitly worker-bound and uses frozen dependency installation', () => {
  const request = developmentBuildPayload({ environment: 'development', runtimeMode: 'development', workerId: 'worker', workspaceId: 'workspace', sandboxId: 'sandbox', sourceRevision: 'revision' })
  expect(request.kind).toBe('workspace.step.run')
  expect(request.payload.runtimeType).toBe('development')
  expect(request.payload.placement).toEqual({ workerId: 'worker', requiredWorkerRole: 'development' })
  expect(request.payload.steps[0].command).toContain('--frozen-lockfile')
  expect(request.payload.steps[1].outputs).toContain('packages/libs/sdk/dist')
})
test.each(['develop', 'preview', 'production'])('native build refuses %s state', (environment) => {
  expect(() => developmentBuildPayload({ environment, runtimeMode: 'development' })).toThrow('bound development workspace')
})
