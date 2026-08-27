export const APP_NAMES = ['api', 'webapp', 'site', 'docs'] as const
export type AppName = (typeof APP_NAMES)[number]
export type ColorScheme = 'light' | 'dark'
export type ViewportName = 'desktop' | 'mobile'
export type Locale = 'en-US' | 'de-DE'

export interface AppContract {
  name: AppName
  envKey: string
  stableEnvKey: string
  hmrEnvKey: string
  defaultUrl: string
  path: string
  kind: 'html' | 'json'
}

export const APP_CONTRACTS: readonly AppContract[] = [
  { name: 'api', envKey: 'SANDBLOCKS_SERVICE_API_URL', stableEnvKey: 'SANDBLOCKS_STABLE_SERVICE_API_URL', hmrEnvKey: 'SANDBLOCKS_SERVICE_API_HMR_URL', defaultUrl: 'https://api.rue.multiterm.dev', path: '/health', kind: 'json' },
  { name: 'webapp', envKey: 'SANDBLOCKS_SERVICE_WEBAPP_URL', stableEnvKey: 'SANDBLOCKS_STABLE_SERVICE_WEBAPP_URL', hmrEnvKey: 'SANDBLOCKS_SERVICE_WEBAPP_HMR_URL', defaultUrl: 'https://app.rue.multiterm.dev', path: '/', kind: 'html' },
  { name: 'site', envKey: 'SANDBLOCKS_SERVICE_SITE_URL', stableEnvKey: 'SANDBLOCKS_STABLE_SERVICE_SITE_URL', hmrEnvKey: 'SANDBLOCKS_SERVICE_SITE_HMR_URL', defaultUrl: 'https://rue.multiterm.dev', path: '/', kind: 'html' },
  { name: 'docs', envKey: 'SANDBLOCKS_SERVICE_DOCS_URL', stableEnvKey: 'SANDBLOCKS_STABLE_SERVICE_DOCS_URL', hmrEnvKey: 'SANDBLOCKS_SERVICE_DOCS_HMR_URL', defaultUrl: 'https://docs.rue.multiterm.dev', path: '/', kind: 'html' },
]

export interface AppPermutation {
  app: AppContract
  colorScheme: ColorScheme
  viewport: ViewportName
  locale: Locale
}

export function resolveAppUrl(app: AppContract, env: NodeJS.ProcessEnv = process.env): string {
  const baseUrl = env[app.envKey]?.trim() || env[app.hmrEnvKey]?.trim() || env[app.stableEnvKey]?.trim() || app.defaultUrl
  return new URL(app.path, `${baseUrl.replace(/\/$/, '')}/`).toString()
}

export function createAppPermutations(): AppPermutation[] {
  const colorSchemes: readonly ColorScheme[] = ['light', 'dark']
  const viewports: readonly ViewportName[] = ['desktop', 'mobile']
  const locales: readonly Locale[] = ['en-US', 'de-DE']
  return APP_CONTRACTS.flatMap((app) => colorSchemes.flatMap((colorScheme) => viewports.flatMap((viewport) => locales.map((locale) => ({ app, colorScheme, viewport, locale })))))
}
