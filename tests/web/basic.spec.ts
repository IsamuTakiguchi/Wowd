import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'

/**
 * ブラウザ版の基本動作。
 *
 * Electron 版と同じ画面が、main プロセス無しで動くこと。
 * ファイルの入口は「開く」ボタン → ファイル選択、出口は共有シートかダウンロード。
 * Playwright は共有シートを持たないので、ダウンロードで確かめる。
 */

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(
    () => (document.querySelector('.wowd-content') as HTMLElement).innerText.replace(/\s+/g, '')
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.wowd-content', { timeout: 20_000 })
})

test('起動して新規文書が開く (テンプレートを fetch で読む)', async ({ page }) => {
  await expect(page.locator('.wowd-content')).toBeVisible()
  await expect(page.locator('[data-testid="file-open"]')).toBeVisible()
  await expect(page.locator('[data-testid="file-save"]')).toBeVisible()
})

test('「開く」でファイルを選んで読める', async ({ page }) => {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-testid="file-open"]').click()
  ])
  await chooser.setFiles('tests/fixtures/docx/01-plain.docx')
  await expect(page.locator('.wowd-content')).toContainText('最初の段落', { timeout: 15_000 })
})

test('編集して保存すると .docx がダウンロードされ、追記が入っている', async ({ page }) => {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-testid="file-open"]').click()
  ])
  await chooser.setFiles('tests/fixtures/docx/01-plain.docx')
  await expect(page.locator('.wowd-content')).toContainText('最初の段落', { timeout: 15_000 })

  await page.locator('.wowd-content p').first().click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.type('ブラウザで追記。')
  await expect(page.locator('[data-testid="file-save"]')).toContainText('*')

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.locator('[data-testid="file-save"]').click()
  ])
  expect(download.suggestedFilename()).toBe('01-plain.docx')
  const path = await download.path()
  const bytes = new Uint8Array(readFileSync(path!))
  const parts = unzipSync(bytes)
  const xml = strFromU8(parts['word/document.xml']!)
  expect(xml).toContain('ブラウザで追記')
  // 保存したら未保存の印が消える
  await expect(page.locator('[data-testid="file-save"]')).not.toContainText('*')
})

test('開いたファイルは「最近使ったファイル」から名前だけで開き直せる', async ({ page }) => {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-testid="file-open"]').click()
  ])
  await chooser.setFiles('tests/fixtures/docx/01-plain.docx')
  await expect(page.locator('.wowd-content')).toContainText('最初の段落', { timeout: 15_000 })

  // 再読み込みで画面は消えるが、IndexedDB の控えは残る
  await page.reload()
  await page.waitForSelector('.wowd-content', { timeout: 20_000 })
  expect(await bodyText(page)).not.toContain('最初の段落')

  await page.evaluate(() =>
    (
      window as unknown as {
        __wowdStore: { getState: () => { openPath: (p: string) => Promise<void> } }
      }
    ).__wowdStore
      .getState()
      .openPath('01-plain.docx')
  )
  await expect(page.locator('.wowd-content')).toContainText('最初の段落', { timeout: 15_000 })
})

test('紙の外を押しても打てる (Electron 版で直した挙動がブラウザでも効く)', async ({ page }) => {
  const box = await page.locator('[data-testid="wowd-page"]').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.keyboard.type('あ')
  await expect(page.locator('.wowd-content')).toContainText('あ')
})

test('ページの JavaScript エラーが出ない', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-testid="file-open"]').click()
  ])
  await chooser.setFiles('tests/fixtures/docx/05-kitchen-sink.docx')
  await expect(page.locator('.wowd-content')).toContainText('総', { timeout: 15_000 })
  await page.locator('button[role="tab"]', { hasText: '校閲' }).click()
  await page.locator('button[role="tab"]', { hasText: '表示' }).click()
  expect(errors, errors.join('\n')).toEqual([])
})
