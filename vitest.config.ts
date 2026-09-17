import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer')
    }
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      thresholds: {
        // src/core/docx はラウンドトリップの生命線なので個別に高い閾値を課す
        'src/core/docx/**/*.ts': { statements: 90, branches: 80, functions: 90, lines: 90 }
      }
    }
  }
})
