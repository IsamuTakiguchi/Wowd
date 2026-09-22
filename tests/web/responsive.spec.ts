import { test, expect, type Page } from '@playwright/test'

/**
 * 画面の広さに応じて作りが変わること。
 *
 * 幅だけの二択だったころは、次の 4 つが壊れていた:
 *   - スマホを横に倒すと幅が 844px になり、パソコン用のリボンが出た
 *   - 721〜833px では A4 (794px) が窓に入らず、横に振らないと右端が見えなかった
 *   - コメントを開くと本文の幅が 280px 減り、紙がさらに入らなくなった
 *   - 縦ルーラが紙の左外に出て、窓が狭いと切れていた
 *
 * 端末ごとの寸法は自分で指定する。設定 (desktop / phone) の寸法には依らない
 */
test.skip(({ isMobile }) => isMobile, '寸法は各テストで指定するので 1 回でよい')

/** 端末を模した寸法で開き、落ち着くまで待つ */
async function openAt(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  await page.goto('/')
  await page.waitForSelector('.wowd-content', { timeout: 30_000 })
  await page.waitForTimeout(700)
}

async function layoutSize(page: Page): Promise<string | null> {
  return page.locator('.app').getAttribute('data-size')
}

/** 窓の外へはみ出していないか (縦横とも) */
async function overflow(page: Page): Promise<{ page: number; viewport: number }> {
  return page.evaluate(() => {
    const de = document.documentElement
    const vp = document.querySelector('.wowd-viewport')
    return {
      page: de.scrollWidth - de.clientWidth,
      viewport: vp ? vp.scrollWidth - vp.clientWidth : 0
    }
  })
}

const CASES: [string, number, number, string][] = [
  ['スマホ 縦', 390, 844, 'compact'],
  ['スマホ 横', 844, 390, 'compact'],
  ['小さめのスマホ', 320, 640, 'compact'],
  ['タブレット 縦', 768, 1024, 'medium'],
  ['タブレット 横', 1024, 768, 'medium'],
  ['半分にした窓', 900, 900, 'medium'],
  ['ノートパソコン', 1280, 800, 'full'],
  ['広い窓', 1680, 1000, 'full']
]

for (const [name, w, h, expected] of CASES) {
  test(`${name} (${w}x${h}) は ${expected} になり、横にはみ出さない`, async ({ page }) => {
    await openAt(page, w, h)
    expect(await layoutSize(page)).toBe(expected)

    const over = await overflow(page)
    expect(over.page, '画面が横にはみ出している').toBeLessThanOrEqual(0)
    expect(over.viewport, '紙が窓からはみ出している').toBeLessThanOrEqual(1)
  })
}

test('スマホを横に倒してもスマホ用の画面のまま', async ({ page }) => {
  await openAt(page, 390, 844)
  await expect(page.locator('[data-testid="mobile-menu"]')).toBeVisible()

  // 倒す。幅は 844px になるが、高さが 390px しかない
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(500)
  await expect(page.locator('[data-testid="mobile-menu"]')).toBeVisible()
  await expect(page.locator('.ribbon-tabs')).toHaveCount(0)
})

test('タブレットの横はリボンのまま (高さがあるので畳まない)', async ({ page }) => {
  await openAt(page, 1024, 768)
  await expect(page.locator('.ribbon-tabs')).toBeVisible()
  await expect(page.locator('[data-testid="mobile-menu"]')).toHaveCount(0)
})

test('窓が狭いときは紙を縮めて収める', async ({ page }) => {
  await openAt(page, 768, 1024)
  const zoom = await page.locator('[data-testid="zoom-readout"]').textContent()
  expect(Number((zoom ?? '').replace('%', ''))).toBeLessThan(100)

  const fits = await page.evaluate(() => {
    const vp = document.querySelector('.wowd-viewport')
    const box = document.querySelector('.wowd-scaler-box')
    if (!vp || !box) return false
    return box.getBoundingClientRect().width <= vp.clientWidth + 1
  })
  expect(fits, '縮めたのに収まっていない').toBe(true)
})

test('広い窓では勝手に拡大しない', async ({ page }) => {
  await openAt(page, 1680, 1000)
  await expect(page.locator('[data-testid="zoom-readout"]')).toHaveText('100%')
})

test('倍率をいじると追従をやめ、「幅に合わせる」で戻る', async ({ page }) => {
  await openAt(page, 768, 1024)
  const fit = page.locator('[data-testid="zoom-fit"]')
  await expect(fit).toHaveAttribute('aria-pressed', 'true')

  // 倍率を動かす
  await page.locator('input[aria-label="表示倍率"]').fill('150')
  await page.waitForTimeout(400)
  await expect(fit).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-testid="zoom-readout"]')).toHaveText('150%')

  await fit.click()
  await page.waitForTimeout(400)
  await expect(fit).toHaveAttribute('aria-pressed', 'true')
  const back = await page.locator('[data-testid="zoom-readout"]').textContent()
  expect(Number((back ?? '').replace('%', ''))).toBeLessThan(100)
})

test('縦ルーラが窓の外に出ない', async ({ page }) => {
  await openAt(page, 768, 1024)
  const ok = await page.evaluate(() => {
    const ruler = document.querySelector('[data-testid="wowd-ruler-v"]')
    const vp = document.querySelector('.wowd-viewport')
    if (!ruler || !vp) return null
    return ruler.getBoundingClientRect().left >= vp.getBoundingClientRect().left - 1
  })
  expect(ok, '縦ルーラが左で切れている').toBe(true)
})

test('コメントを開いても紙の幅が減らない (狭い窓では重ねる)', async ({ page }) => {
  await openAt(page, 900, 900)
  const before = await page.evaluate(
    () => document.querySelector('.wowd-scaler-box')?.getBoundingClientRect().width ?? 0
  )

  await page.locator('button[role="tab"]', { hasText: '校閲' }).click()
  await page.locator('button[title*="コメント"]').first().click()
  await page.waitForTimeout(700)
  await expect(page.locator('.comments-pane')).toBeVisible()

  const after = await page.evaluate(
    () => document.querySelector('.wowd-scaler-box')?.getBoundingClientRect().width ?? 0
  )
  expect(Math.abs(after - before), '紙が細くなった').toBeLessThan(2)
})

test('ダイアログが画面からはみ出さない', async ({ page }) => {
  await openAt(page, 390, 844)
  // スマホの「その他」からページ設定を開く
  await page.locator('[data-testid="mobile-menu"]').click()
  const item = page.locator('button', { hasText: '印刷レイアウト' }).first()
  if (await item.count()) await page.keyboard.press('Escape')

  // 画面の幅に収まる上限が入っていること (dialog は中身なりに広がるため)
  const limited = await page.evaluate(() => {
    const el = document.createElement('dialog')
    el.className = 'wowd-dialog'
    document.body.append(el)
    const max = getComputedStyle(el).maxWidth
    el.remove()
    return max
  })
  expect(limited, 'ダイアログに幅の上限が無い').not.toBe('none')
})
