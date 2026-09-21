import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * ブラウザ版 (スマホを含む) のビルド。
 *
 * Electron 版は electron.vite.config.ts が作る。画面のコードは同じで、
 * 入口の HTML と、OS の機能に触る層 (src/renderer/platform) だけが違う。
 *
 * 出力先は dist-web/。静的なファイルだけなので、どこに置いても動く
 * (GitHub Pages / 事務所のサーバ / 手元の PC)。
 */
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

export default defineConfig({
  root: resolve('web'),
  // 相対パスにしておく。GitHub Pages のように / 直下でない置き場でも動くように
  base: './',
  // resources/ をそのまま静的ファイルとして配る。
  // 新規文書のテンプレート (templates/*.docx) とアイコンがここにある
  publicDir: resolve('resources'),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer')
    }
  },
  plugins: [
    react(),
    {
      // manifest と sw.js は Vite が拾わない静的ファイル。
      // SW は入口と同じ階層に無いと画面全体を担当できないので、ここで root に出す
      name: 'wowd-web-static',
      generateBundle() {
        for (const name of ['manifest.webmanifest', 'sw.js']) {
          this.emitFile({
            type: 'asset',
            fileName: name,
            source: readFileSync(resolve('web', name), 'utf8').replace('__APP_VERSION__', pkg.version)
          })
        }
      }
    }
  ],
  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true,
    // .docx の読み書きは Web Worker で行う。Vite が new Worker(new URL(...)) を拾う
    target: 'es2022'
  },
  worker: {
    format: 'es'
  },
  server: {
    // スマホから LAN 経由で開けるようにする
    host: true,
    port: 5174
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true
  }
})
