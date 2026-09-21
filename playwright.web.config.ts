import { defineConfig, devices } from '@playwright/test'
import { globSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ブラウザ版の E2E。Electron 版 (playwright.config.ts) とは別に回す。
 *
 * dist-web/ を vite preview で配り、Chromium で開く。
 * スマホは Pixel 7 の寸法と指操作を模した設定で見る。
 * iPhone (WebKit) はこの環境に無いので、そこは実機で確かめる。
 */

/** Playwright 付属の Chromium が無い環境では、入っている実体を探す */
function chromiumPath(): string | undefined {
  const root = process.env['PLAYWRIGHT_BROWSERS_PATH']
  if (!root) return undefined
  return globSync(join(root, 'chromium*', 'chrome-linux', 'chrome')).find((p) => existsSync(p))
}

const executablePath = chromiumPath()

export default defineConfig({
  testDir: 'tests/web',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'list' : 'line',
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { executablePath, args: ['--no-sandbox'] },
    acceptDownloads: true
  },
  webServer: {
    command: 'npx vite preview --config vite.web.config.ts',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 30_000
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args: ['--no-sandbox'] } } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath, args: ['--no-sandbox'] } } }
  ]
})
