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
  await expect(page.locator('.wowd-content')).toBeVisible()
  await page.waitForTimeout(600)
}

async function newDocument(): Promise<void> {
  await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { newDocument: (t: string) => Promise<void> } }
      }
    ).__wowdStore
    await store.getState().newDocument('blank-a4')
  })
  await page.locator('button[role="tab"]', { hasText: 'ホーム' }).click()
}

test('ルビつき文書を開くとふりがなが表示される', async () => {
  await openFixture('06-ruby.docx')

  const rubies = page.locator('.wowd-content ruby')
  await expect(rubies).toHaveCount(4)
  await expect(rubies.first()).toContainText('薔薇')
  await expect(rubies.first().locator('rt')).toHaveText('ばら')

  // ベース文字とふりがなが上下に並ぶ (ruby として組まれている)
  const layout = await rubies.first().evaluate((el) => {
    const rt = el.querySelector('rt')!
    const base = el.getBoundingClientRect()
    const reading = rt.getBoundingClientRect()
    return { rtTop: reading.top, baseBottom: base.bottom }
  })
  expect(layout.rtTop).toBeLessThan(layout.baseBottom)
})

test('選択した文字列にルビを挿入できる', async () => {
  await newDocument()
  await page.locator('.wowd-content').click()
  await page.keyboard.type('漢字')
  await page.keyboard.press('Control+a')

  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await page.locator('button[title="選択した文字列にふりがなを付ける"]').click()

  const dialog = page.locator('dialog.wowd-dialog')
  await expect(dialog).toBeVisible()
  // 選択範囲がベース文字として入っている
  await expect(dialog.locator('[data-testid="ruby-base"]')).toHaveValue('漢字')

  await dialog.locator('[data-testid="ruby-reading"]').fill('かんじ')
  await dialog.locator('button.is-primary').click()

  await expect(page.locator('.wowd-content ruby')).toHaveCount(1)
  await expect(page.locator('.wowd-content ruby rt')).toHaveText('かんじ')
})

test('挿入したルビが保存して開き直しても残る', async () => {
  // 直前のテストで挿入したルビを、保存経路を通して往復させる
  const bytes = await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { saveToBytes: () => Promise<number[]> } }
      }
    ).__wowdStore
    return store.getState().saveToBytes()
  })
  expect(bytes.length, '保存できていない').toBeGreaterThan(0)

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

  await expect(page.locator('.wowd-content ruby')).toHaveCount(1)
  await expect(page.locator('.wowd-content ruby rt')).toHaveText('かんじ')
})

test('文字数と行数の指定がダイアログに反映される', async () => {
  await openFixture('07-grid-40x36.docx')

  // リボンの表示にも出る
  await page.locator('button[role="tab"]', { hasText: 'レイアウト' }).click()
  await expect(page.locator('[data-testid="grid-readout"]')).toContainText('40 字 × 36 行')

  await page.locator('button[title="用紙・余白と文字数と行数をまとめて設定する"]').click()
  const dialog = page.locator('dialog.wowd-dialog')
  await expect(dialog).toBeVisible()

  await dialog.locator('button[role="tab"]', { hasText: '文字数と行数' }).click()
  await expect(dialog.locator('[data-testid="grid-chars"]')).toHaveValue('40')
  await expect(dialog.locator('[data-testid="grid-lines"]')).toHaveValue('36')

  await dialog.locator('button', { hasText: 'キャンセル' }).click()
  await expect(dialog).toHaveCount(0)
})

test('文字数と行数を変更するとページの行送りが変わる', async () => {
  await openFixture('07-grid-40x36.docx')
  const before = await page
    .locator('.wowd-flow')
    .evaluate((el) => getComputedStyle(el).lineHeight)

  await page.locator('button[role="tab"]', { hasText: 'レイアウト' }).click()
  await page.locator('button[title="用紙・余白と文字数と行数をまとめて設定する"]').click()
  const dialog = page.locator('dialog.wowd-dialog')
  await dialog.locator('button[role="tab"]', { hasText: '文字数と行数' }).click()
  await dialog.locator('[data-testid="grid-lines"]').fill('20')
  await dialog.locator('button.is-primary').click()

  await expect(page.locator('[data-testid="grid-readout"]')).toContainText('× 20 行')
  const after = await page
    .locator('.wowd-flow')
    .evaluate((el) => getComputedStyle(el).lineHeight)
  // 行数を減らしたので 1 行あたりの送りは広がる
  expect(parseFloat(after)).toBeGreaterThan(parseFloat(before))
})

test('原稿用紙のマス目を表示できる', async () => {
  await openFixture('07-grid-40x36.docx')
  await page.locator('button[role="tab"]', { hasText: '表示' }).click()

  const button = page.locator('button[title="文字数と行数の指定に合わせてマス目を表示する"]')
  await expect(button).toBeEnabled()
  await button.click()

  const background = await page
    .locator('.wowd-flow')
    .evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(background).toContain('gradient')

  await button.click()
})

test('文字数と行数の指定が無い文書ではマス目を出せない', async () => {
  await openFixture('01-plain.docx')
  await page.locator('button[role="tab"]', { hasText: '表示' }).click()
  await expect(
    page.locator('button[title="この文書には文字数と行数の指定がありません"]')
  ).toBeDisabled()
})
