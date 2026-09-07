import type { FullConfig } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
export default async function teardown(config: FullConfig) {
  const directory = config.metadata.rueApiE2eData
  if (typeof directory !== 'string' || dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('rue-api-e2e-')) throw new Error('Refusing to clean an unexpected API test directory')
  await rm(directory, { recursive: true, force: true })
}
