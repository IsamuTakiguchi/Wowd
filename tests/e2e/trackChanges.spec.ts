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
 * 変更履歴を実アプリで確かめる。
 *
 * 不変条件そのものは tests/unit/trackChanges.test.ts で細かく見ている。
 * ここでは「実際に打鍵した結果が赤入りになり、保存して開き直しても残る」
 * という、単体テストでは通らない経路を見る。
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

async function openReviewTab(): Promise<void> {
  await page.locator('button[role="tab"]', { hasText: '校閲' }).click()
}

/** 本文の先頭にカーソルを置く。クリックの処理が落ち着くまで待つ */
async function caretAtStart(): Promise<void> {
  await page.locator('.wowd-content p').first().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+Home')
  await page.waitForTimeout(100)
}

async function setTracking(on: boolean): Promise<void> {
  await openReviewTab()
  const button = page.locator('button[title="変更履歴の記録を開始または終了する"]')
  const active = (await button.getAttribute('aria-pressed')) === 'true'
  if (active !== on) await button.click()
  await expect(button).toHaveAttribute('aria-pressed', String(on))
}

test('既存文書の変更履歴が表示される', async () => {
  await openFixture('10-revisions.docx')
  await expect(page.locator('.wowd-content ins.wowd-ins')).toHaveCount(1)
  await expect(page.locator('.wowd-content del.wowd-del')).toHaveCount(1)
  await expect(page.locator('.wowd-content ins.wowd-ins')).toContainText('挿入された文')
  await expect(page.locator('.wowd-content del.wowd-del')).toContainText('削除された文')
})

test('著者ごとに色が変わる', async () => {
  const insColor = await page
    .locator('.wowd-content ins.wowd-ins')
    .first()
    .evaluate((el) => getComputedStyle(el).color)
  const delColor = await page
    .locator('.wowd-content del.wowd-del')
    .first()
    .evaluate((el) => getComputedStyle(el).color)
  // 校閲者A と 校閲者B は別の色になる
  expect(insColor).not.toBe(delColor)
})

test('段落記号の挿入・削除が行末に出る', async () => {
  await expect(page.locator('.wowd-content [data-para-revision="ins"]')).toHaveCount(1)
  await expect(page.locator('.wowd-content [data-para-revision="del"]')).toHaveCount(1)
})

test('表示モードで変更の見え方が切り替わる', async () => {
  await openReviewTab()
  const select = page.locator('select[title="変更履歴の表示方法"]')

  await select.selectOption('final')
  await expect(page.locator('.wowd-content del.wowd-del')).toBeHidden()
  await expect(page.locator('.wowd-content ins.wowd-ins')).toBeVisible()

  await select.selectOption('original')
  await expect(page.locator('.wowd-content ins.wowd-ins')).toBeHidden()
  await expect(page.locator('.wowd-content del.wowd-del')).toBeVisible()

  await select.selectOption('all')
  await expect(page.locator('.wowd-content ins.wowd-ins')).toBeVisible()
  await expect(page.locator('.wowd-content del.wowd-del')).toBeVisible()

  // 隠しても文書からは消えない。保存内容は表示モードに左右されない
  await expect(page.locator('.wowd-content')).toContainText('削除された文')
})

test('記録中に打った文字が挿入として残る', async () => {
  await openFixture('01-plain.docx')
  await setTracking(true)
  await caretAtStart()
  await page.keyboard.type('追記')

  const ins = page.locator('.wowd-content ins.wowd-ins')
  await expect(ins).toHaveCount(1)
  await expect(ins).toContainText('追記')
  await expect(ins).toHaveAttribute('title', /挿入/)
})

test('記録中に消した文字は消えずに削除として残る', async () => {
  await openFixture('01-plain.docx')
  const before = (await page.locator('.wowd-content').innerText()).replace(/\s/g, '')
  await setTracking(true)
  await caretAtStart()
  // 先頭の 3 文字を選んで消す
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Delete')

  await expect(page.locator('.wowd-content del.wowd-del')).toHaveCount(1)
  // 文字自体は残っている
  const after = (await page.locator('.wowd-content').innerText()).replace(/\s/g, '')
  expect(after).toBe(before)
})

test('記録した変更が保存して開き直しても残る', async () => {
  await openFixture('01-plain.docx')
  // 著者名は localStorage に残るので、既定値を当てにせず明示する
  await openReviewTab()
  await page.locator('[data-testid="revision-author"]').fill('保存テスト者')
  await setTracking(true)
  await caretAtStart()
  await page.keyboard.type('保存確認')
  await expect(page.locator('.wowd-content ins.wowd-ins')).toContainText('保存確認')

  await saveAndReopen()

  const ins = page.locator('.wowd-content ins.wowd-ins')
  await expect(ins).toHaveCount(1)
  await expect(ins).toContainText('保存確認')
  await expect(ins).toHaveAttribute('title', /保存テスト者/)
})

test('すべて承諾すると赤入りが本文になる', async () => {
  await openFixture('01-plain.docx')
  await setTracking(true)
  await caretAtStart()
  await page.keyboard.type('承諾する文字')
  await expect(page.locator('.wowd-content ins.wowd-ins')).toHaveCount(1)

  await setTracking(false)
  await openReviewTab()
  await page.locator('button[title="文書中のすべての変更を反映する"]').click()

  await expect(page.locator('.wowd-content ins.wowd-ins')).toHaveCount(0)
  await expect(page.locator('.wowd-content')).toContainText('承諾する文字')
})

test('すべて元に戻すと編集前の本文に戻る', async () => {
  await openFixture('01-plain.docx')
  const before = (await page.locator('.wowd-content').innerText()).replace(/\s/g, '')

  await setTracking(true)
  await caretAtStart()
  await page.keyboard.type('取り消される文字')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Delete')
  await expect(page.locator('.wowd-content ins.wowd-ins').first()).toBeVisible()

  await setTracking(false)
  await openReviewTab()
  await page.locator('button[title="文書中のすべての変更を取り消す"]').click()

  await expect(page.locator('.wowd-content ins.wowd-ins')).toHaveCount(0)
  await expect(page.locator('.wowd-content del.wowd-del')).toHaveCount(0)
  const after = (await page.locator('.wowd-content').innerText()).replace(/\s/g, '')
  expect(after).toBe(before)
})

test('記録を止めれば普通に編集できる', async () => {
  await openFixture('01-plain.docx')
  await setTracking(false)
  await caretAtStart()
  await page.keyboard.type('記録しない文字')

  await expect(page.locator('.wowd-content ins.wowd-ins')).toHaveCount(0)
  await expect(page.locator('.wowd-content')).toContainText('記録しない文字')
})

test('次の変更へ移動できる', async () => {
  await openFixture('10-revisions.docx')
  // 選択が画面に出るように、先に本文へフォーカスを移す
  await caretAtStart()
  await openReviewTab()
  await page.locator('button[title="次の変更箇所へ移動する"]').click()

  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected.length).toBeGreaterThan(0)
})

test('記録中に書式を変えると履歴に残る', async () => {
  await openFixture('01-plain.docx')
  await openReviewTab()
  await page.locator('[data-testid="revision-author"]').fill('書式テスト者')
  await setTracking(true)
  await caretAtStart()

  // 先頭の 4 文字を選んで太字にする
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.locator('button[role="tab"]', { hasText: 'ホーム' }).click()
  await page.locator('button[title="太字"]').click()

  // 書式が変わったことが印として出る
  await expect(page.locator('.wowd-content [data-format-revision="run"]')).toHaveCount(1)

  // 保存して開き直しても残る (w:rPrChange として書き出されている)
  await saveAndReopen()
  await expect(page.locator('.wowd-content [data-format-revision="run"]')).toHaveCount(1)
  await expect(page.locator('.wowd-content [data-format-revision="run"]')).toHaveAttribute(
    'title',
    /書式/
  )
})

test('書式の変更を取り消すと元の書式に戻る', async () => {
  await openFixture('01-plain.docx')
  // このフィクスチャには元から太字がある。増減で見る
  const before = await page.locator('.wowd-content strong').count()

  await setTracking(true)
  await caretAtStart()
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.locator('button[role="tab"]', { hasText: 'ホーム' }).click()
  await page.locator('button[title="太字"]').click()
  await expect(page.locator('.wowd-content [data-format-revision="run"]')).toHaveCount(1)
  await expect(page.locator('.wowd-content strong')).toHaveCount(before + 1)

  await setTracking(false)
  await openReviewTab()
  await page.locator('button[title="文書中のすべての変更を取り消す"]').click()

  await expect(page.locator('.wowd-content [data-format-revision="run"]')).toHaveCount(0)
  await expect(
    page.locator('.wowd-content strong'),
    '取り消しても太字が残っている'
  ).toHaveCount(before)
})
