import { test, expect } from '@playwright/test'

/**
 * スマホの寸法で使えること。
 *
 * Pixel 7 の設定で開く。指で押す端末では、ボタンは 44px 以上ないと押し損ねる。
 * 横にはみ出して横スクロールが出ると、画面全体が動いて文書が読めない。
 */
test.skip(({ isMobile }) => !isMobile, 'スマホの設定でだけ見る')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.wowd-content', { timeout: 20_000 })
})

test('ファイル操作のボタンが指で押せる大きさ', async ({ page }) => {
  for (const id of ['file-open', 'file-save', 'file-new']) {
    const box = await page.locator(`[data-testid="${id}"]`).boundingBox()
    expect(box, id).not.toBeNull()
    expect(box!.height, `${id} が低すぎる`).toBeGreaterThanOrEqual(44)
  }
})

test('画面が横にはみ出さない', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow, '横スクロールが出ている').toBeLessThanOrEqual(0)
})

test('文書を開いて読める', async ({ page }) => {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-testid="file-open"]').tap()
  ])
  await chooser.setFiles('tests/fixtures/docx/01-plain.docx')
  await expect(page.locator('.wowd-content')).toContainText('最初の段落', { timeout: 15_000 })
})
