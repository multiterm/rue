const { join } = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const config = getDefaultConfig(__dirname)
const original = config.resolver.resolveRequest
// Shared UI has web React development dependencies. Native rendering must use
// the Expo application's matching React/renderer pair, including JSX runtimes.
config.resolver.resolveRequest = (context, name, platform) => {
  if (['react', 'react-dom', 'react-native-web'].some(pkg => name === pkg || name.startsWith(`${pkg}/`))) {
    return { type: 'sourceFile', filePath: require.resolve(name) }
  }
  if (platform !== 'web' && (name === 'react-native' || name.startsWith('react-native/'))) {
    context = { ...context, originModulePath: join(__dirname, 'app', '_layout.tsx') }
  }
  return original ? original(context, name, platform) : context.resolveRequest(context, name, platform)
}
const blocked = config.resolver.blockList
config.resolver.blockList = [...(Array.isArray(blocked) ? blocked : blocked ? [blocked] : []), /[/\\]\.worktrees[/\\]/]
module.exports = config
