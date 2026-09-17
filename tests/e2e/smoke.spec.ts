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

/** 各テストを独立させる。前のテストの入力内容に依存しないようにする */
test.beforeEach(async () => {
  await page.evaluate(async () => {
    const store = (window as unknown as { __wowdStore: { getState: () => { newDocument: (t: string) => Promise<void> } } })
      .__wowdStore
    await store.getState().newDocument('blank-a4')
  })
  await page.locator('button[role="tab"]', { hasText: 'ホーム' }).click()
  await expect(page.locator('.wowd-content')).toBeVisible()
})

/** 本文に文字を入力する */
async function typeBody(text: string): Promise<void> {
  await page.locator('.wowd-content').click()
  await page.keyboard.type(text)
}

test('起動して空の A4 文書が開く', async () => {
  await expect(page.locator('.ribbon-appname')).toHaveText('Wowd')
  const width = await page
    .locator('[data-testid="wowd-page"]')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).width))
  // A4 の幅 11906 twip = 595.3pt = 793.7px
  expect(width).toBeGreaterThan(780)
  expect(width).toBeLessThan(810)
})

test('文字を入力して太字にできる', async () => {
  await typeBody('これはテストです')
  await expect(page.locator('.wowd-content')).toContainText('これはテストです')

  await page.keyboard.press('Control+a')
  await page.locator('button[title="太字"]').click()
  await expect(page.locator('.wowd-content strong')).toHaveCount(1)

  await expect(page.locator('.statusbar')).toContainText('文字数: 8')
})

test('元に戻すとやり直しが効く', async () => {
  await typeBody('取り消される文字')
  await expect(page.locator('.wowd-content')).toContainText('取り消される文字')

  await page.keyboard.press('Control+z')
  await expect(page.locator('.wowd-content')).not.toContainText('取り消される文字')

  await page.keyboard.press('Control+y')
  await expect(page.locator('.wowd-content')).toContainText('取り消される文字')
})

test('見出しスタイルを適用できる', async () => {
  await typeBody('第1章 総則')
  await page.locator('select[title="スタイル"]').selectOption('Heading1')
  await expect(page.locator('.wowd-content h1')).toHaveCount(1)
  await expect(page.locator('.wowd-content h1')).toContainText('第1章 総則')
})

test('段落の配置を変えられる', async () => {
  await typeBody('中央に寄せる段落')
  await page.locator('button[title="中央揃え"]').click()
  const align = await page
    .locator('.wowd-content p')
    .first()
    .evaluate((el) => getComputedStyle(el).textAlign)
  expect(align).toBe('center')
})

test('検索パネルで一致件数が出て、全角半角を区別しない', async () => {
  await typeBody('テストと ﾃｽﾄ と test')
  await page.locator('button[title="検索と置換"]').click()
  await expect(page.locator('.find-panel')).toBeVisible()

  const input = page.locator('.find-field input').first()

  await input.fill('テスト')
  await expect(page.locator('.find-status')).toContainText('2 件中 1 件目')

  // 全角半角の正規化を切ると半角カナは一致しなくなる
  await page.locator('.find-option', { hasText: '全角と半角を区別しない' }).locator('input').uncheck()
  await expect(page.locator('.find-status')).toContainText('1 件中 1 件目')

  await page.locator('.find-panel button[aria-label="閉じる"]').click()
  await expect(page.locator('.find-panel')).toHaveCount(0)
})

test('リボンのタブを切り替えられる', async () => {
  await page.locator('button[role="tab"]', { hasText: 'レイアウト' }).click()
  await expect(page.locator('select[title="用紙サイズ"]')).toBeVisible()

  await page.locator('button[role="tab"]', { hasText: '表示' }).click()
  await expect(page.locator('select[title="表示倍率"]')).toBeVisible()

  await page.locator('button[role="tab"]', { hasText: 'ホーム' }).click()
  await expect(page.locator('button[title="太字"]')).toBeVisible()
})

test('実ファイルを開いて本文・見出し・リストが表示される', async () => {
  const fixture = join(process.cwd(), 'tests', 'fixtures', 'docx', '05-kitchen-sink.docx')
  const bytes = Array.from(new Uint8Array(readFileSync(fixture)))

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

  await expect(page.locator('.wowd-content')).toContainText('総合テスト文書')
  await expect(page.locator('.wowd-content')).toContainText('和文')
  await expect(page.locator('.wowd-content')).toContainText('番号項目')

  // pStyle="Heading1" が heading ノードに写ること
  await expect(page.locator('.wowd-content h1')).toHaveCount(1)
  // リストの行頭記号が Decoration として描かれること
  await expect(page.locator('.wowd-list-marker').first()).toBeVisible()
  await expect(page.locator('.wowd-list-marker').first()).toHaveText(/\(1\)/)

  // 未対応要素が無い文書なので警告バナーは出ない
  await expect(page.locator('.banner-warn')).toHaveCount(0)
})
