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
    plugins: ['expo-router', 'expo-secure-store', ['expo-camera',{cameraPermission:'Scan Rue pairing QR codes to link this device.'}]],
    experiments: { typedRoutes: true },
    ios: { bundleIdentifier: `dev.multiterm.rue${suffix}`, supportsTablet: true, associatedDomains:['applinks:app.rue.multiterm.dev'] },
    android: { package: `dev.multiterm.rue${suffix}`, intentFilters:[{action:'VIEW',autoVerify:true,data:[{scheme:'https',host:'app.rue.multiterm.dev',pathPrefix:'/link'}],category:['BROWSABLE','DEFAULT']}] },
    extra: {
      appVariant: variant,
      keynameApiUrl: process.env.EXPO_PUBLIC_KEYNAME_API_URL ?? 'https://api.keyname.dev',
      keynameClientId: process.env.EXPO_PUBLIC_KEYNAME_CLIENT_ID ?? '',
      rueApiUrl: process.env.EXPO_PUBLIC_RUE_API_URL ?? 'https://api.rue.multiterm.dev',
    },
  }
}
