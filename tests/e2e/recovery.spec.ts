import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

/**
 * 自動保存とクラッシュ復帰。
 *
 * 退避は userData に書かれ、正常終了で消える。ここでは
 * 「退避を書ける」「書いたものを読み直せる」「消せる」を通しで見る。
 * 実際の異常終了は再現しないが、復帰に使う経路はすべて同じ。
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

/**
 * preload が公開している API。
 * e2e 側の tsconfig には renderer の型宣言が入らないので、ここで形を書く。
 */
interface WowdBridge {
  listRecovery: () => Promise<{ id: string; originalPath: string | null; savedAt: number }[]>
  readRecovery: (id: string) => Promise<Uint8Array | null>
  clearRecovery: () => Promise<void>
}

type WowdWindow = Window & {
  wowd: WowdBridge
  __wowdSaveRecovery: () => Promise<boolean>
  __wowdStore: {
    getState: () => { openBytes: (b: Uint8Array, p: string | null) => Promise<void> }
  }
}

/** 退避を今すぐ書く。間隔を待たずに確かめるため */
async function saveRecoveryNow(): Promise<boolean> {
  return page.evaluate(() => (window as unknown as WowdWindow).__wowdSaveRecovery())
}

test('未保存の変更が無ければ退避しない', async () => {
  await page.evaluate(() => (window as unknown as WowdWindow).wowd.clearRecovery())
  expect(await saveRecoveryNow()).toBe(false)
  const entries = await page.evaluate(() => (window as unknown as WowdWindow).wowd.listRecovery())
  expect(entries).toHaveLength(0)
})

test('編集すると退避が書かれ、読み直せる', async () => {
  await page.locator('.wowd-content').click()
  await page.waitForTimeout(200)
  await page.keyboard.type('自動保存の確認')

  expect(await saveRecoveryNow()).toBe(true)

  const entries = await page.evaluate(() => (window as unknown as WowdWindow).wowd.listRecovery())
  expect(entries).toHaveLength(1)
  expect(entries[0]?.savedAt).toBeGreaterThan(0)
  // 未保存の文書なので元のパスは無い
  expect(entries[0]?.originalPath).toBeNull()

  // 退避を読み直すと本文が戻る
  const restored = await page.evaluate(async (id: string) => {
    const win = window as unknown as WowdWindow
    const bytes = await win.wowd.readRecovery(id)
    if (!bytes) return null
    await win.__wowdStore.getState().openBytes(bytes, null)
    return bytes.length
  }, entries[0]?.id ?? '')
  expect(restored).toBeGreaterThan(0)
  await expect(page.locator('.wowd-content')).toContainText('自動保存の確認')
})

test('退避が残っていれば復元の案内が出る', async () => {
  await page.reload()
  await page.waitForSelector('.wowd-content', { timeout: 30_000 })
  await expect(page.locator('.recovery-list button').first()).toBeVisible()

  await page.locator('.recovery-list button').first().click()
  await expect(page.locator('.wowd-content')).toContainText('自動保存の確認')
})

test('捨てると案内が消え、退避も消える', async () => {
  await page.reload()
  await page.waitForSelector('.wowd-content', { timeout: 30_000 })
  const banner = page.locator('.banner-warn', { hasText: '前回は保存されずに終了しました' })
  await expect(banner).toBeVisible()
  await banner.locator('button').last().click()

  await expect(banner).toHaveCount(0)
  const entries = await page.evaluate(() => (window as unknown as WowdWindow).wowd.listRecovery())
  expect(entries).toHaveLength(0)
})

test('不正な id では何も読めない', async () => {
  // renderer にパスを組み立てさせない。id は英数字だけを受け付ける
  const results = await page.evaluate(async () => {
    const win = window as unknown as WowdWindow
    const bad = ['../../etc/passwd', '/etc/passwd', '', 'a'.repeat(200)]
    return Promise.all(bad.map((id) => win.wowd.readRecovery(id)))
  })
  for (const result of results) expect(result).toBeNull()
})
