import {fileURLToPath} from 'node:url'

// Explicit API-only configuration, not a workspace-wide auto-loader.
export default {
 envPath:fileURLToPath(new URL('../.locker/api',import.meta.url)),
 envKeysFile:fileURLToPath(new URL('../.env.keys',import.meta.url)),
 environmentLayout:'directory',
 cascade:false,
 autoDetect:true,
 nodeEnvMap:{development:'dev',preview:'preview',production:'prod'},
 override:false,
 quiet:true,
 expand:false,
 required:['RUE_PUSH_PRIVATE_KEY','RUE_PUSH_PUBLIC_KEY','RUE_PUSH_SUBJECT'],
}
