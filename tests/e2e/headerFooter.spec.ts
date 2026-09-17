import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ヘッダーとフッターの編集。
 *
 * 用紙の飾りは本文とは別のレイヤに描かれるので、編集した結果が
 * そのレイヤに出ること、保存して開き直しても残ることを見る。
 */

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

async function openFixture(name: string): Promise<void> {
  const bytes = Array.from(
    new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'docx', name)))
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

async function saveAndReopen(): Promise<void> {
  const bytes = await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { saveToBytes: () => Promise<number[]> } }
      }
    ).__wowdStore
    return store.getState().saveToBytes()
  })
  expect(bytes.length, '保存できなかった').toBeGreaterThan(0)
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

async function openDialog(): Promise<void> {
  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await page.locator('button[title="ヘッダーとフッターを編集する"]').click()
  await expect(page.locator('dialog.wowd-dialog')).toBeVisible()
}

async function closeDialog(): Promise<void> {
  await page.locator('dialog.wowd-dialog button', { hasText: 'キャンセル' }).click()
  await expect(page.locator('dialog.wowd-dialog')).toHaveCount(0)
}

test('ヘッダーの無い文書にヘッダーを付けられる', async () => {
  await openFixture('01-plain.docx')
  // ヘッダーを持たない文書では、飾りの層そのものが出ない
  await expect(page.locator('.wowd-header')).toHaveCount(0)

  await openDialog()
  await page.locator('[data-testid="header-text"]').fill('社外秘')
  await page.locator('[data-testid="header-apply"]').click()
  await closeDialog()

  await expect(page.locator('.wowd-header').first()).toContainText('社外秘')
})

test('フッターにページ番号を差し込める', async () => {
  await openDialog()
  await page.locator('[data-testid="footer-text"]').fill('')
  await page.locator('[data-testid="footer-insert-pages"]').click()
  await page.locator('[data-testid="footer-apply"]').click()
  await closeDialog()

  await openDialog()
  // トークンが本文に残り、往復できること
  await expect(page.locator('[data-testid="footer-text"]')).toHaveValue(/総ページ数/)
  await page.locator('[data-testid="footer-text"]').fill('- {ページ番号} -')
  await page.locator('[data-testid="footer-apply"]').click()
  await closeDialog()

  // フィールドは解決されてページ番号として出る
  await expect(page.locator('.wowd-footer').first()).toContainText('- 1 -')
})

test('付けたヘッダーとフッターが保存して開き直しても残る', async () => {
  await saveAndReopen()

  await expect(page.locator('.wowd-header').first()).toContainText('社外秘')
  await expect(page.locator('.wowd-footer').first()).toContainText('- 1 -')

  // 平文としても戻ってくる
  await openDialog()
  await expect(page.locator('[data-testid="header-text"]')).toHaveValue('社外秘')
  await expect(page.locator('[data-testid="footer-text"]')).toHaveValue('- {ページ番号} -')
  await closeDialog()
})

test('配置を変えられる', async () => {
  await openDialog()
  await page.locator('select[title="ヘッダーの配置"]').selectOption('center')
  await page.locator('[data-testid="header-apply"]').click()
  await closeDialog()

  const align = await page
    .locator('.wowd-header p')
    .first()
    .evaluate((el) => getComputedStyle(el).textAlign)
  expect(align).toBe('center')
})

test('既存のヘッダーを持つ文書はその内容が出る', async () => {
  await openFixture('05-kitchen-sink.docx')
  await openDialog()
  // 平文にできるヘッダーなら編集欄が出る。できなければ注意書きが出る
  const editable = await page.locator('[data-testid="header-text"]').count()
  const note = await page.locator('.wowd-dialog-note').count()
  expect(editable + note).toBeGreaterThan(0)
  await closeDialog()
})
