import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { countPdfPages, isPdf } from './helpers/pdf'

let app: ElectronApplication
let page: Page
let workDir: string

test.beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'wowd-pdf-'))
  app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.wowd-content', { timeout: 30_000 })
})

test.afterAll(async () => {
  await app.close()
  rmSync(workDir, { recursive: true, force: true })
})

test.beforeEach(async () => {
  await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { newDocument: (t: string) => Promise<void> } }
      }
    ).__wowdStore
    await store.getState().newDocument('blank-a4')
  })
  await expect(page.locator('.wowd-content')).toBeVisible()
})

async function waitForPagination(): Promise<void> {
  await expect
    .poll(
      async () => {
        const a = await page.locator('.wowd-page-backdrop').count()
        await page.waitForTimeout(220)
        const b = await page.locator('.wowd-page-backdrop').count()
        return a === b ? b : -1
      },
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0)
}

async function printTo(target: string): Promise<{ path: string | null; pageCount: number }> {
  return page.evaluate(async (p) => {
    const fn = (
      window as unknown as {
        __wowdPrint: (t: string) => Promise<{ path: string | null; pageCount: number }>
      }
    ).__wowdPrint
    return fn(p)
  }, target)
}

test('空文書を PDF に出力できる', async () => {
  await waitForPagination()
  const target = join(workDir, 'empty.pdf')
  const result = await printTo(target)

  expect(result.path).toBe(target)
  expect(existsSync(target)).toBe(true)
  const bytes = readFileSync(target)
  expect(isPdf(bytes), 'PDF として成立していない').toBe(true)
  expect(countPdfPages(bytes)).toBe(1)
})

/**
 * この検証がいちばん重要。
 * 画面のページ数と PDF のページ数が一致しなければ、
 * 「画面の見た目と PDF が一致する」という約束が成り立っていない。
 */
test('画面のページ数と PDF のページ数が一致する', async () => {
  await page.locator('.wowd-content').click()
  for (let i = 0; i < 120; i++) {
    await page.keyboard.type(`第${i + 1}段落。PDF 出力の確認用の文章です。`)
    await page.keyboard.press('Enter')
  }
  await waitForPagination()

  const onScreen = await page.locator('.wowd-page-backdrop').count()
  expect(onScreen).toBeGreaterThan(1)

  const target = join(workDir, 'multi.pdf')
  const result = await printTo(target)

  expect(result.pageCount, '組み立てたページ数が画面と違う').toBe(onScreen)
  const bytes = readFileSync(target)
  expect(isPdf(bytes)).toBe(true)
  expect(countPdfPages(bytes), 'PDF のページ数が画面と違う').toBe(onScreen)
})

test('用紙サイズを変えると PDF の用紙も変わる', async () => {
  await page.locator('button[role="tab"]', { hasText: 'レイアウト' }).click()
  await page.locator('select[title="用紙サイズ"]').selectOption('b5')
  await waitForPagination()

  const target = join(workDir, 'b5.pdf')
  await printTo(target)
  const text = readFileSync(target).toString('latin1')

  // B5 = 182 x 257mm = 515.9 x 728.5pt。PDF の MediaBox はポイント単位
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(text)
  expect(box, 'MediaBox が見つからない').not.toBeNull()
  const width = Number(box![1])
  const height = Number(box![2])
  expect(width).toBeGreaterThan(500)
  expect(width).toBeLessThan(530)
  expect(height).toBeGreaterThan(715)
  expect(height).toBeLessThan(745)

  await page.locator('select[title="用紙サイズ"]').selectOption('a4')
})

test('改ページを入れた位置で PDF も分かれる', async () => {
  await page.locator('.wowd-content').click()
  await page.keyboard.type('1ページ目')
  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await page.locator('button[title="改ページを挿入する (Ctrl+Enter)"]').click()
  await page.locator('.wowd-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('2ページ目')
  await waitForPagination()

  const target = join(workDir, 'break.pdf')
  await printTo(target)
  expect(countPdfPages(readFileSync(target))).toBe(2)
})
