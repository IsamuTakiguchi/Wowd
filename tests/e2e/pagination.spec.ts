import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

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

test.beforeEach(async () => {
  await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { newDocument: (t: string) => Promise<void> } }
      }
    ).__wowdStore
    await store.getState().newDocument('blank-a4')
  })
  await page.locator('button[role="tab"]', { hasText: 'ホーム' }).click()
  await expect(page.locator('.wowd-content')).toBeVisible()
})

/** 指定した段落数を入力する */
async function typeParagraphs(count: number): Promise<void> {
  await page.locator('.wowd-content').click()
  for (let i = 0; i < count; i++) {
    await page.keyboard.type(`第${i + 1}段落。ページ分割の確認用の文章です。`)
    await page.keyboard.press('Enter')
  }
  await waitForPagination()
}

/** ページ分割が落ち着くまで待つ。固定待ちだと不安定になるので枚数の安定を見る */
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

test('空文書は 1 ページになる', async () => {
  await waitForPagination()
  await expect(page.locator('.wowd-page-backdrop')).toHaveCount(1)
  await expect(page.locator('[data-testid="page-count"]')).toContainText('1 ページ')
})

test('本文が増えるとページが増える', async () => {
  await typeParagraphs(90)
  const pages = await page.locator('.wowd-page-backdrop').count()
  expect(pages).toBeGreaterThan(1)
  await expect(page.locator('[data-testid="page-count"]')).toContainText(`${pages} ページ`)
})

test('どのブロックもページ境界を跨がない', async () => {
  await typeParagraphs(90)

  const straddling = await page.evaluate(() => {
    const stage = document.querySelector('.wowd-stage') as HTMLElement
    const stageTop = stage.getBoundingClientRect().top
    const pages = Array.from(document.querySelectorAll('.wowd-page-backdrop')).map((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top - stageTop, bottom: r.bottom - stageTop }
    })
    const flow = document.querySelector('.wowd-flow') as HTMLElement
    const cs = getComputedStyle(flow)
    const padT = parseFloat(cs.paddingTop)
    const padB = parseFloat(cs.paddingBottom)

    const content = document.querySelector('.wowd-content') as HTMLElement
    let bad = 0
    for (const el of Array.from(content.children)) {
      if (el.hasAttribute('data-wowd-spacer')) continue
      const r = el.getBoundingClientRect()
      const top = r.top - stageTop
      const bottom = r.bottom - stageTop
      // 1px の誤差は丸めの範囲として許す
      const fits = pages.some((p) => top >= p.top + padT - 1 && bottom <= p.bottom - padB + 1)
      if (!fits) bad++
    }
    return bad
  })

  expect(straddling, 'ページ境界を跨ぐブロックがある').toBe(0)
})

test('用紙は A4 の実寸で描かれる', async () => {
  await waitForPagination()
  const size = await page
    .locator('.wowd-page-backdrop')
    .first()
    .evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }))
  // A4 = 210 x 297mm = 793.7 x 1122.5 px
  expect(size.w).toBeGreaterThan(780)
  expect(size.w).toBeLessThan(810)
  expect(size.h).toBeGreaterThan(1100)
  expect(size.h).toBeLessThan(1140)
})

test('倍率を変えても改ページ位置は動かない', async () => {
  await typeParagraphs(90)
  const before = await page.locator('.wowd-page-backdrop').count()

  await page.locator('button[role="tab"]', { hasText: '表示' }).click()
  await page.locator('select[title="表示倍率"]').selectOption('150')
  await waitForPagination()

  // CSS の zoom はレイアウトに影響して改ページ位置が動くので transform を使っている。
  // ここが崩れると「画面の見た目と PDF 出力が一致する」前提が壊れる
  await expect(page.locator('.wowd-page-backdrop')).toHaveCount(before)

  await page.locator('select[title="表示倍率"]').selectOption('100')
})

test('下書き表示に切り替えるとページ分割しない', async () => {
  await typeParagraphs(40)
  await page.locator('button[role="tab"]', { hasText: '表示' }).click()
  await page.locator('button[title="ページ分割せず連続して表示する"]').click()

  await expect(page.locator('.wowd-page-backdrop')).toHaveCount(0)
  await expect(page.locator('.wowd-spacer')).toHaveCount(0)
  // 本文は消えない
  await expect(page.locator('.wowd-content')).toContainText('第1段落')

  await page.locator('button[title="ページに分割して用紙として表示する"]').click()
  await waitForPagination()
})

test('改ページを挿入すると次のページから始まる', async () => {
  await page.locator('.wowd-content').click()
  await page.keyboard.type('前のページ')
  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await page.locator('button[title="改ページを挿入する (Ctrl+Enter)"]').click()
  await page.locator('.wowd-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('次のページ')
  await waitForPagination()

  await expect(page.locator('.wowd-page-backdrop')).toHaveCount(2)
})
