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
})

/**
 * 表の構造を画面から読む。
 *
 * ストアの document は読み込み時と保存時にしか更新されないので、
 * 編集途中の状態はそこには無い。利用者が見ているものと比べたいので DOM を見る。
 */
async function tableShape(): Promise<number[][]> {
  return page.evaluate(() => {
    const table = document.querySelector('.wowd-content table')
    if (!table) return []
    return Array.from(table.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll('td, th')).map((cell) => {
        const c = cell as HTMLTableCellElement
        return c.colSpan * 100 + c.rowSpan
      })
    )
  })
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
  await page.waitForTimeout(400)
}

test('表を挿入できる', async () => {
  await page.locator('.wowd-content').click()
  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await page.locator('button[title="3 行 3 列の表を挿入する"]').click()

  await expect(page.locator('.wowd-content table')).toHaveCount(1)
  await expect(page.locator('.wowd-content tr')).toHaveCount(3)
  await expect(page.locator('.wowd-content td, .wowd-content th')).toHaveCount(9)
})

test('挿入した表が保存して開き直しても残る', async () => {
  await page.locator('.wowd-content').click()
  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await page.locator('button[title="2 行 2 列の表を挿入する"]').click()

  // セルに文字を入れる
  await page.locator('.wowd-content td, .wowd-content th').first().click()
  await page.keyboard.type('セルの中身')

  const before = await tableShape()
  await saveAndReopen()

  await expect(page.locator('.wowd-content table')).toHaveCount(1)
  await expect(page.locator('.wowd-content')).toContainText('セルの中身')
  expect(await tableShape(), '表の構造が変わった').toEqual(before)
})

test('行と列を追加できる', async () => {
  await page.locator('.wowd-content').click()
  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await page.locator('button[title="2 行 2 列の表を挿入する"]').click()
  await page.locator('.wowd-content td, .wowd-content th').first().click()

  await page.locator('button[title="下に行を追加する"]').click()
  await expect(page.locator('.wowd-content tr')).toHaveCount(3)

  await page.locator('button[title="右に列を追加する"]').click()
  await expect(page.locator('.wowd-content td, .wowd-content th')).toHaveCount(9)
})

test('表の外では表の編集ボタンが無効になる', async () => {
  await page.locator('.wowd-content').click()
  await page.keyboard.type('表ではない段落')
  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await expect(page.locator('button[title="下に行を追加する"]')).toBeDisabled()
})

test('既存文書の結合セルが表示され、構造も保たれる', async () => {
  const bytes = Array.from(
    new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'docx', '08-tables.docx')))
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
  await page.waitForTimeout(400)

  await expect(page.locator('.wowd-content table')).toHaveCount(1)
  await expect(page.locator('.wowd-content')).toContainText('結合セル')

  // 横結合が colspan として出ている
  const colspans = await page
    .locator('.wowd-content td[colspan], .wowd-content th[colspan]')
    .evaluateAll((els) => els.map((el) => (el as HTMLTableCellElement).colSpan))
  expect(colspans).toContain(2)

  const before = await tableShape()
  await saveAndReopen()
  expect(await tableShape(), '結合の構造が変わった').toEqual(before)
})
