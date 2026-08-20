#!/usr/bin/env node
/**
 * Binary entry for `rue`. Run via `pnpm --filter @multiterm/rue-core dev` (which
 * uses tsx), or after build/install via the package `bin` field.
 */
import { run } from './cli/index.js'

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})
