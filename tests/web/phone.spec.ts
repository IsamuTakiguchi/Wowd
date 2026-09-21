import { test, expect, type Page } from '@playwright/test'

/**
 * スマホの寸法で使えること (Pixel 7 の設定)。
 *
 * リボンは 412px の画面では文字が縦に潰れて読めない (実測した)。
 * スマホでは上下のバーだけの画面に切り替わり、本文は画面の幅で折り返す。
 * 指で押す端末では、ボタンは 44px 以上ないと押し損ねる。
 */
test.skip(({ isMobile }) => !isMobile, 'スマホの設定でだけ見る')

async function openFixture(page: Page, name: string): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-testid="file-open"]').tap()
  ])
  await chooser.setFiles(`tests/fixtures/docx/${name}`)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.wowd-content', { timeout: 20_000 })
})

test('リボンではなくスマホ用のバーが出る', async ({ page }) => {
  await expect(page.locator('.mobile-topbar')).toBeVisible()
  await expect(page.locator('.mobile-bottombar')).toBeVisible()
  await expect(page.locator('.ribbon')).toHaveCount(0)
  await expect(page.locator('.statusbar')).toHaveCount(0)
})

test('ボタンが指で押せる大きさ', async ({ page }) => {
  for (const id of ['file-open', 'file-save', 'mobile-menu', 'mobile-comments', 'mobile-next']) {
    const box = await page.locator(`[data-testid="${id}"]`).boundingBox()
    expect(box, id).not.toBeNull()
    expect(box!.height, `${id} が低すぎる`).toBeGreaterThanOrEqual(44)
    expect(box!.width, `${id} が狭すぎる`).toBeGreaterThanOrEqual(44)
  }
})

test('最初は下書き表示で、本文が画面の幅に収まる', async ({ page }) => {
  await openFixture(page, '01-plain.docx')
  await expect(page.locator('.wowd-content')).toContainText('最初の段落', { timeout: 15_000 })
  await expect(page.locator('.wowd-viewport')).toHaveAttribute('data-view-mode', 'draft')

  const width = page.viewportSize()!.width
  const para = await page.locator('.wowd-content p').first().boundingBox()
  expect(para).not.toBeNull()
  expect(para!.x, '本文が左に隠れている').toBeGreaterThanOrEqual(0)
  expect(para!.x + para!.width, '本文が右にはみ出している').toBeLessThanOrEqual(width + 1)
  // 文字が小さすぎない (紙を縮めているのではなく、折り返している)
  const fontPx = await page.locator('.wowd-content p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(fontPx).toBeGreaterThanOrEqual(12)
})

test('横にはみ出さない (画面も本文の枠も)', async ({ page }) => {
  await openFixture(page, '05-kitchen-sink.docx')
  await expect(page.locator('.wowd-content')).toContainText('総', { timeout: 15_000 })
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    viewport: (() => {
      const v = document.querySelector('.wowd-viewport')!
      return v.scrollWidth - v.clientWidth
    })()
  }))
  expect(overflow.page, '画面全体に横スクロールが出ている').toBeLessThanOrEqual(0)
  expect(overflow.viewport, '本文の枠に横スクロールが出ている').toBeLessThanOrEqual(0)
})

test('コメントが下から開き、画面に収まる', async ({ page }) => {
  await openFixture(page, '14-comments.docx')
  await expect(page.locator('.wowd-content')).toContainText('コメントが付いた', { timeout: 15_000 })
  await expect(page.locator('[data-testid="mobile-comments"]')).toContainText('コメント 2')

  await page.locator('[data-testid="mobile-comments"]').tap()
  const pane = page.locator('.comments-pane')
  await expect(pane).toBeVisible()
  const box = await pane.boundingBox()
  const { width, height } = page.viewportSize()!
  expect(box!.width, 'コメント欄が画面の幅いっぱいでない').toBeGreaterThanOrEqual(width - 2)
  expect(box!.y + box!.height, 'コメント欄が画面の下にはみ出す').toBeLessThanOrEqual(height + 1)
  expect(box!.y, 'コメント欄が本文を全部隠している').toBeGreaterThan(height * 0.3)
  await expect(pane.locator('.comment-thread')).toHaveCount(2)
})

test('変更の見え方を下のバーで切り替えられる', async ({ page }) => {
  await openFixture(page, '10-revisions.docx')
  await expect(page.locator('.wowd-content ins.wowd-ins')).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-testid="mobile-display"]').selectOption('final')
  await expect(page.locator('.wowd-content del.wowd-del')).toBeHidden()
  await page.locator('[data-testid="mobile-display"]').selectOption('all')
  await expect(page.locator('.wowd-content del.wowd-del')).toBeVisible()
})

test('印刷レイアウトに切り替えると紙が画面の幅に収まる', async ({ page }) => {
  await openFixture(page, '01-plain.docx')
  await expect(page.locator('.wowd-content')).toContainText('最初の段落', { timeout: 15_000 })
  await page.locator('[data-testid="mobile-menu"]').tap()
  await page.locator('[data-testid="mobile-view"]').tap()
  await expect(page.locator('.wowd-viewport')).toHaveAttribute('data-view-mode', 'print')
  await page.waitForTimeout(600)

  const width = page.viewportSize()!.width
  const box = await page.locator('.wowd-scaler-box').boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width, '紙が画面より広い').toBeLessThanOrEqual(width)
  expect(box!.x, '紙が左に隠れている').toBeGreaterThanOrEqual(0)
})

test('その他のメニューから新規文書を作れる', async ({ page }) => {
  await openFixture(page, '01-plain.docx')
  await expect(page.locator('.wowd-content')).toContainText('最初の段落', { timeout: 15_000 })
  await page.locator('[data-testid="mobile-menu"]').tap()
  await page.locator('[data-testid="file-new"]').tap()
  await expect(page.locator('.wowd-content')).not.toContainText('最初の段落')
  await expect(page.locator('.mobile-menu')).toHaveCount(0)
})
