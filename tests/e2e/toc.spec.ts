import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.wowd-content', { timeout: 30_000 })
})

test.afterAll(async () => {
  await app.close()
})

/** 見出しを 3 つ持つ文書を開く。入力手順に頼ると不安定なのでフィクスチャを使う */
async function documentWithHeadings(): Promise<void> {
  const bytes = Array.from(
    new Uint8Array(
      readFileSync(join(process.cwd(), 'tests', 'fixtures', 'docx', '13-headings.docx'))
    )
  )
  await page.evaluate(async (data) => {
    const store = (
      window as unknown as {
        __wowdStore: {
          getState: () => { openBytes: (b: Uint8Array, p: string | null) => Promise<void> }
        }
      }
    ).__wowdStore
    await store.getState().openBytes(new Uint8Array(data), null)
  }, bytes)
  await page.waitForTimeout(500)
}

test('見出しから目次を作れる', async () => {
  await documentWithHeadings()

  await page.locator('button[role="tab"]', { hasText: '参考資料' }).click()
  await page.locator('button[title="見出しから目次を作る。すでにあれば作り直す"]').click()

  await expect(page.locator('[data-testid="toc-status"]')).toContainText('3 件の見出し')

  // 目次の各行が見出しの文字列を含む
  const tocLines = page.locator('.wowd-content [data-style^="TOC"]')
  await expect(tocLines).toHaveCount(4) // TOCHeading + 3 行
  await expect(page.locator('.wowd-content')).toContainText('第1章 総則')

  // 目次の見出しと PAGEREF フィールドが入っている
  await expect(page.locator('.wowd-content [data-style="TOCHeading"]')).toContainText('目次')
  const fields = page.locator('.wowd-field')
  await expect(fields).toHaveCount(4) // TOC フィールド + 各行の PAGEREF
  await expect(
    page.locator('.wowd-field[title*="PAGEREF"]').first(),
    'ページ番号フィールドが無い'
  ).toHaveCount(1)
})

test('二度実行しても目次が二重にならない', async () => {
  await page.locator('button[title="見出しから目次を作る。すでにあれば作り直す"]').click()
  await page.waitForTimeout(400)

  const tocHeadings = page.locator('.wowd-content [data-style="TOCHeading"]')
  await expect(tocHeadings).toHaveCount(1)
})

test('目次が保存して開き直しても残る', async () => {
  const bytes = await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { saveToBytes: () => Promise<number[]> } }
      }
    ).__wowdStore
    return store.getState().saveToBytes()
  })
  expect(bytes.length).toBeGreaterThan(0)

  await page.evaluate(async (data) => {
    const store = (
      window as unknown as {
        __wowdStore: {
          getState: () => { openBytes: (b: Uint8Array, p: string | null) => Promise<void> }
        }
      }
    ).__wowdStore
    await store.getState().openBytes(new Uint8Array(data), null)
  }, bytes)
  await page.waitForTimeout(400)

  await expect(page.locator('.wowd-content [data-style="TOCHeading"]')).toHaveCount(1)
  await expect(page.locator('.wowd-content [data-style^="TOC"]')).toHaveCount(4)

  // 保存した XML に TOC フィールドとブックマークが入っていること
  const xml = await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { saveToBytes: () => Promise<number[]> } }
      }
    ).__wowdStore
    const bytes = await store.getState().saveToBytes()
    return bytes.length
  })
  expect(xml).toBeGreaterThan(0)
})

test('見出しが無い文書ではその旨を知らせる', async () => {
  await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { newDocument: (t: string) => Promise<void> } }
      }
    ).__wowdStore
    await store.getState().newDocument('blank-a4')
  })
  await page.locator('.wowd-content').click()
  await page.keyboard.type('見出しのない本文だけの文書')

  await page.locator('button[role="tab"]', { hasText: '参考資料' }).click()
  await page.locator('button[title="見出しから目次を作る。すでにあれば作り直す"]').click()
  await expect(page.locator('[data-testid="toc-status"]')).toContainText('見出しが見つかりません')
})
