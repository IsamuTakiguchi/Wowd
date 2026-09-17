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
 * 画像の挿入。
 *
 * ファイル選択ダイアログは自動では押せないので、main 側の
 * showOpenDialog を差し替えて「選ばれた」ことにする。
 * それ以外の経路 (読み込み・登録・挿入・保存) は実物をそのまま通す。
 */

let app: ElectronApplication
let page: Page

const SAMPLE = join(process.cwd(), 'tests', 'fixtures', 'sample.png')

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

/** 次のファイル選択でこのパスが選ばれたことにする */
async function stubFilePicker(path: string | null): Promise<void> {
  await app.evaluate(async ({ dialog }, picked: string | null) => {
    dialog.showOpenDialog = (async () => ({
      canceled: picked === null,
      filePaths: picked === null ? [] : [picked]
    })) as unknown as typeof dialog.showOpenDialog
  }, path)
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

async function insertImage(): Promise<void> {
  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await page.locator('button[title="画像ファイルを選んで本文に挿入する"]').click()
}

test('画像を選んで挿入できる', async () => {
  await stubFilePicker(SAMPLE)
  await page.locator('.wowd-content').click()
  await page.waitForTimeout(200)
  await insertImage()

  const img = page.locator('.wowd-content img.wowd-image')
  await expect(img).toHaveCount(1)
  await expect(img).toBeVisible()

  // blob URL になっていること (data URL だと巨大な文字列が DOM に載る)
  const src = await img.getAttribute('src')
  expect(src).toMatch(/^blob:/)
})

test('取り消したときは何も挿入されない', async () => {
  const before = await page.locator('.wowd-content img.wowd-image').count()
  await stubFilePicker(null)
  await insertImage()
  await page.waitForTimeout(300)
  expect(await page.locator('.wowd-content img.wowd-image').count()).toBe(before)
})

test('挿入した画像が保存して開き直しても残る', async () => {
  await saveAndReopen()

  const img = page.locator('.wowd-content img.wowd-image')
  await expect(img).toHaveCount(1)
  const src = await img.getAttribute('src')
  expect(src).toMatch(/^blob:/)

  // 元のバイト列がそのまま入っていること
  const size = await page.evaluate(() => {
    const store = (
      window as unknown as {
        __wowdStore: {
          getState: () => {
            document: { resources: { media: Map<string, { bytes: Uint8Array }> } } | null
          }
        }
      }
    ).__wowdStore
    const media = store.getState().document?.resources.media
    if (!media) return 0
    return [...media.values()][0]?.bytes.length ?? 0
  })
  expect(size).toBe(readFileSync(SAMPLE).length)
})

test('本文の幅に収まる大きさで置かれる', async () => {
  const [imgWidth, flowWidth] = await Promise.all([
    page.locator('.wowd-content img.wowd-image').evaluate((el) => el.getBoundingClientRect().width),
    page.locator('[data-testid="wowd-flow"]').evaluate((el) => el.getBoundingClientRect().width)
  ])
  expect(imgWidth).toBeGreaterThan(0)
  expect(imgWidth).toBeLessThanOrEqual(flowWidth + 1)
})
