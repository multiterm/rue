import {defineConfig} from 'vitest/config'
export default defineConfig({test:{include:['quality/**/*.test.ts'],coverage:{provider:'v8',enabled:true,include:['quality/app-contract.ts'],reporter:['text','json'],reportsDirectory:'coverage/quality',thresholds:{statements:100,branches:100,functions:100,lines:100}}}})
