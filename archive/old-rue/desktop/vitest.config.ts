import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/main/capture/html.ts',
        'src/main/notebook/rank.ts',
        'src/main/agents/format.ts',
        'src/renderer/src/lib/**/*.ts'
      ],
      exclude: ['src/renderer/src/lib/ocr.ts', 'src/renderer/src/lib/pdf.ts', 'src/renderer/src/lib/voice.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75
      }
    }
  }
})
