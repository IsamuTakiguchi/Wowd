import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync, strFromU8 } from 'fflate'

let app: ElectronApplication
let page: Page
let workDir: string

test.beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'wowd-e2e-'))
  app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.wowd-content', { timeout: 30_000 })
})

test.afterAll(async () => {
  await app.close()
  rmSync(workDir, { recursive: true, force: true })
})

/**
 * アプリを通した実ファイルのラウンドトリップ。
 *
 * 単体テストはモデル層だけを見ているので、エディタを経由して
 * 「読む → 編集する → 保存する → 読み直す」が壊れていないことをここで確かめる。
 */
test('開いて編集して保存し、内容と未編集パートが保たれる', async () => {
  const source = join(process.cwd(), 'tests', 'fixtures', 'docx', '05-kitchen-sink.docx')
  const target = join(workDir, 'saved.docx')
  const bytes = Array.from(new Uint8Array(readFileSync(source)))

  // 開く
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

  // 末尾に文字を足す
  await page.locator('.wowd-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('追記した一文。')
  await expect(page.locator('.wowd-content')).toContainText('追記した一文。')

  // 保存 (ダイアログを出さずに直接書き出す)
  await page.evaluate(async (path) => {
    const store = (
      window as unknown as {
        __wowdStore: {
          getState: () => { save: () => Promise<boolean> }
          setState: (p: Record<string, unknown>) => void
        }
      }
    ).__wowdStore
    store.setState({ filePath: path })
    const ok = await store.getState().save()
    if (!ok) throw new Error('保存に失敗しました')
  }, target)

  expect(existsSync(target)).toBe(true)

  // 保存したファイルの中身を検証する
  const saved = unzipSync(new Uint8Array(readFileSync(target)))
  const original = unzipSync(new Uint8Array(readFileSync(source)))

  const documentXml = strFromU8(saved['word/document.xml']!)
  expect(documentXml).toContain('追記した一文。')
  expect(documentXml).toContain('総合テスト文書')

  // 本文以外のパートは 1 バイトも変わっていないこと
  for (const part of Object.keys(original).filter((n) => !n.endsWith('/'))) {
    expect(Object.keys(saved), `${part} が失われた`).toContain(part)
    if (part === 'word/document.xml') continue
    expect(Array.from(saved[part]!), `${part} が変わっている`).toEqual(Array.from(original[part]!))
  }

  // 保存したファイルを開き直して内容が一致すること
  const savedBytes = Array.from(new Uint8Array(readFileSync(target)))
  await page.evaluate(async (data) => {
    const store = (
      window as unknown as {
        __wowdStore: {
          getState: () => { openBytes: (b: Uint8Array, p: string | null) => Promise<void> }
        }
      }
    ).__wowdStore
    await store.getState().openBytes(new Uint8Array(data), null)
  }, savedBytes)

  await expect(page.locator('.wowd-content')).toContainText('追記した一文。')
  await expect(page.locator('.wowd-content')).toContainText('総合テスト文書')
  await expect(page.locator('.wowd-content h1')).toHaveCount(1)
  await expect(page.locator('.wowd-list-marker').first()).toBeVisible()
})
