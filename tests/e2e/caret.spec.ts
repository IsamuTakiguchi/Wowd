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
 * 紙の上のどこを押しても打てること。
 *
 * ProseMirror が扱うのは本文 (.wowd-content) の中のクリックだけ。
 * 用紙の余白や、本文より下の何もない所を押すとフォーカスが外れ、
 * 打っても何も入らなかった。新規文書は本文が先頭の 1 行 (高さ 16px) しか
 * 無いので、紙の 99% の面積で「押しても何も起きない」状態だった。
 * Windows の実機で「クリックしても入力する場所を指定できない」と報告があり、
 * Linux でも同じ手順で再現した。
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

async function newDocument(): Promise<void> {
  await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { newDocument: (t: string) => Promise<void> } }
      }
    ).__wowdStore
    await store.getState().newDocument('blank-a4')
  })
  await page.waitForTimeout(800)
}

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
  await page.waitForTimeout(800)
}

async function boxes(): Promise<{
  page: { l: number; r: number; t: number; b: number }
  content: { l: number; r: number; t: number; b: number }
}> {
  return page.evaluate(() => {
    const pb = document.querySelector('[data-testid="wowd-page"]')!.getBoundingClientRect()
    const cb = document.querySelector('.wowd-content')!.getBoundingClientRect()
    return {
      page: { l: pb.left, r: pb.right, t: pb.top, b: pb.bottom },
      content: { l: cb.left, r: cb.right, t: cb.top, b: cb.bottom }
    }
  })
}

async function bodyText(): Promise<string> {
  return page.evaluate(() =>
    (document.querySelector('.wowd-content') as HTMLElement).innerText.replace(/\s+/g, '')
  )
}

/** そこを押して打ったら本文に入るか */
async function typesAt(x: number, y: number, ch: string): Promise<boolean> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  const before = await bodyText()
  await page.mouse.click(x, y)
  await page.waitForTimeout(200)
  await page.keyboard.type(ch)
  await page.waitForTimeout(150)
  return (await bodyText()) !== before
}

test('新規文書で紙の真ん中を押して打てる', async () => {
  await newDocument()
  const { page: p } = await boxes()
  expect(await typesAt((p.l + p.r) / 2, (p.t + p.b) / 2, 'あ'), '紙の真ん中').toBe(true)
  await expect(page.locator('.wowd-content')).toContainText('あ')
})

test('余白を押しても打てる (左・右・上)', async () => {
  await newDocument()
  const { page: p, content: c } = await boxes()
  const y = c.t + 8
  expect(await typesAt(p.l + 30, y, 'い'), '左の余白').toBe(true)
  expect(await typesAt(p.r - 30, y, 'う'), '右の余白').toBe(true)
  expect(await typesAt((p.l + p.r) / 2, p.t + 30, 'え'), '上の余白 (ヘッダー領域)').toBe(true)
})

test('左の余白は行頭、右の余白は行末に付く', async () => {
  await openFixture('01-plain.docx')
  const { page: p, content: c } = await boxes()
  const firstLineY = c.t + 8

  // 左の余白 → 行頭に入る
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.mouse.click(p.l + 20, firstLineY)
  await page.waitForTimeout(200)
  await page.keyboard.type('【頭】')
  await expect(page.locator('.wowd-content p').first()).toHaveText(/^【頭】/)

  // 右の余白 → 行末に入る
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.mouse.click(p.r - 20, firstLineY)
  await page.waitForTimeout(200)
  await page.keyboard.type('【尾】')
  const first = await page.locator('.wowd-content p').first().innerText()
  // 1 行目が折り返していなければ段落末、折り返していれば行末。どちらも「頭」より後ろ
  expect(first.indexOf('【尾】')).toBeGreaterThan(first.indexOf('【頭】'))
})

test('本文の中の範囲選択は今までどおりできる', async () => {
  // 余白の処理が本文のクリックまで奪うと、ドラッグ選択が壊れる
  await openFixture('01-plain.docx')
  const { content: c } = await boxes()
  const y = c.t + 8
  await page.mouse.move(c.l + 5, y)
  await page.mouse.down()
  await page.mouse.move(c.l + 120, y, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(selected.length, 'ドラッグで選べなくなった').toBeGreaterThan(1)
})
