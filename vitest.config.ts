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
        /**
         * src/core/docx はラウンドトリップの生命線なので個別に閾値を課す。
         *
         * この値は**到達点であって目標ではない**。90/80/90 を目指していたが
         * 届いていないので、いまの実測値を歯止めとして置いている。
         * CI が評価するので、ここから下がることはもう無い。
         *
         * 下げるときは必ず理由をここに書くこと。上げるのは歓迎。
         * 残っている薄い箇所は read/run.ts と read/paragraph.ts の
         * 分岐 (実文書にしか出てこない属性の組み合わせ) が中心で、
         * 利用者から実物の .docx を受け取れば自然に埋まる。
         */
        'src/core/docx/**/*.ts': { statements: 84, branches: 68, functions: 90, lines: 88 }
      }
    }
  }
})
