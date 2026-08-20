import type { ConfigContext, ExpoConfig } from '@expo/config'
type Variant = 'development' | 'preview' | 'production'
export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = (process.env.APP_VARIANT ?? process.env.RUNWAY_BUILD_TYPE ?? 'development') as Variant
  if (!['development', 'preview', 'production'].includes(variant)) throw new Error(`invalid APP_VARIANT: ${variant}`)
  const suffix = variant === 'production' ? '' : `.${variant}`
  return {
    ...config,
    name: variant === 'production' ? 'Rue' : `Rue (${variant})`,
    slug: 'rue',
    scheme: 'rue',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    plugins: ['expo-router', 'expo-secure-store'],
    experiments: { typedRoutes: true },
    ios: { bundleIdentifier: `dev.multiterm.rue${suffix}`, supportsTablet: true },
    android: { package: `dev.multiterm.rue${suffix}` },
    extra: {
      appVariant: variant,
      keynameApiUrl: process.env.EXPO_PUBLIC_KEYNAME_API_URL ?? 'https://api.keyname.dev',
      keynameClientId: process.env.EXPO_PUBLIC_KEYNAME_CLIENT_ID ?? '',
    },
  }
}
