/**
 * @multiterm/rue-core — library entry point.
 *
 * Re-exports the major surfaces other workspace packages consume. The CLI
 * entry is `./bin.ts` (referenced from package.json `bin`).
 */
export const RUE_CORE_VERSION = '0.0.0'

export * as Storage from './storage/index.js'
export * as Config from './config/index.js'
export * as Server from './server/index.js'
export * as Auth from './auth/index.js'
export * as Bus from './bus/index.js'
export * as Migrate from './migrate/index.js'
export * as Paths from './global/index.js'
export * as Provider from './provider/index.js'
export * as Session from './session/index.js'
