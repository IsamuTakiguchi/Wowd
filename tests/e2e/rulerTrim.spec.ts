import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let app: ElectronApplication
let page: Page
let workDir: string

test.beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'wowd-ruler-'))
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

test.beforeEach(async () => {
  await page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { newDocument: (t: string) => Promise<void> } }
      }
    ).__wowdStore
    await store.getState().newDocument('blank-a4')
  })
  await expect(page.locator('.wowd-content')).toBeVisible()
  // 既定はルーラあり・トンボなし。
  // この 2 つは localStorage に残るので、前の実行の状態に引きずられないよう毎回そろえる
  await setToggle('余白と字下げの目盛り', true)
  await setToggle('断裁位置', false)
})

/**
 * 表示タブのトグルを目的の状態にする。
 *
 * 押すのではなく「その状態にする」。設定が保存される作りなので、
 * 押すだけだと前の実行の状態で結果が反転する。
 */
async function setToggle(titlePart: string, want: boolean): Promise<void> {
  await page.locator('button[role="tab"]', { hasText: '表示' }).click()
  const button = page.locator(`button[title*="${titlePart}"]`)
  if ((await button.getAttribute('aria-pressed')) !== String(want)) {
    await button.click()
  }
  await expect(button).toHaveAttribute('aria-pressed', String(want))
  // ページ分割の作り直しを待つ
  await page.waitForTimeout(600)
}

/**
 * 紙が 2 枚になる文書を作る。
 *
 * 改ページを入れたあとは**クリックせずにそのまま打つ**。
 * 改ページは 1 個のノードとして選択されるので、本文をクリックし直すと
 * それを選んだ状態になり、次に打った文字が改ページを置き換えてしまう
 * (実際にそうなって 1 枚のままになった)。
 */
async function makeTwoPages(): Promise<void> {
  // 分割が 1 枚で落ち着いてから始める。
  // 直前のトグルで作り直しが走っている最中に入れると取りこぼす
  await waitForPagination(1)
  await page.locator('.wowd-content').click()
  await page.keyboard.type('1 枚目')
  await page.locator('button[role="tab"]', { hasText: '挿入' }).click()
  await page.locator('button[title="改ページを挿入する (Ctrl+Enter)"]').click()
  await page.keyboard.type('2 枚目')
  await expect(page.locator('.wowd-content [data-page-break]')).toHaveCount(1)
  await waitForPagination(2)
}

/**
 * 紙の枚数が目的の数で落ち着くまで待つ。
 *
 * ページ分割は実測してから走るので、打ち終わった直後はまだ 1 枚のことがある。
 * 固定時間で待つと環境によって取りこぼす。
 */
async function waitForPagination(expected: number): Promise<void> {
  await expect
    .poll(async () => page.locator('.wowd-page-backdrop').count(), { timeout: 15_000 })
    .toBe(expected)
}

async function pageBox(index = 0): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('.wowd-page-backdrop').nth(index).boundingBox()
  if (!box) throw new Error('用紙が見つからない')
  return box
}

test.describe('ルーラ', () => {
  test('表示タブで出し入れできる', async () => {
    await expect(page.locator('[data-testid="wowd-ruler-h"]')).toBeVisible()
    await expect(page.locator('[data-testid="wowd-ruler-v"]').first()).toBeVisible()

    await setToggle('余白と字下げの目盛り', false)
    await expect(page.locator('[data-testid="wowd-ruler-h"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="wowd-ruler-v"]')).toHaveCount(0)
  })

  /** 目盛りが紙とずれていたら定規として使えない */
  test('目盛りの原点が本文の左端に合う', async () => {
    await page.locator('.wowd-content').click()
    await page.keyboard.type('あ')

    const handle = await page.locator('[data-testid="ruler-handle-left"]').boundingBox()
    const text = await page.locator('.wowd-content p').first().boundingBox()
    if (!handle || !text) throw new Error('位置が取れない')

    // 四角のつまみの中心が、本文の左端に来る
    const center = handle.x + handle.width / 2
    expect(Math.abs(center - text.x)).toBeLessThan(2)
  })

  test('縦ルーラは紙 1 枚につき 1 本出る', async () => {
    await makeTwoPages()
    await expect(page.locator('.wowd-page-backdrop')).toHaveCount(2)
    await expect(page.locator('[data-testid="wowd-ruler-v"]')).toHaveCount(2)
  })

  /**
   * つまみは字下げが 0 のとき 3 つとも同じ位置に重なる。
   * 当たり判定を上下で分けていないと、上の三角をつかんだつもりで
   * 下の三角が動く (実際にそうなっていた)。
   */
  test('1 行目の三角は 1 行目だけを動かす', async () => {
    await page.locator('.wowd-content').click()
    await page.keyboard.type(
      'ここは折り返しを起こすために十分に長い段落です。' +
        '1 行目だけが下がり、2 行目は元の位置に残ることを確かめます。' +
        'そのためにもう少し文字を足しておきます。'
    )
    await page.waitForTimeout(500)

    const handle = await page.locator('[data-testid="ruler-handle-firstLine"]').boundingBox()
    if (!handle) throw new Error('つまみが無い')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2, {
      steps: 6
    })
    await page.mouse.up()
    await page.waitForTimeout(500)

    // 段落の CSS で見る。1 行目だけ下げるのは正の text-indent
    const style = await page.locator('.wowd-content p').first().evaluate((el) => {
      const cs = getComputedStyle(el)
      return { textIndent: cs.textIndent, marginLeft: cs.marginInlineStart }
    })
    expect(parseFloat(style.textIndent)).toBeGreaterThan(30)
    // 段落全体は動いていない
    expect(parseFloat(style.marginLeft || '0')).toBeLessThan(2)
  })

  test('三角をつかんで動かすと字下げが変わる', async () => {
    await page.locator('.wowd-content').click()
    await page.keyboard.type('字下げを試す段落')

    const before = await page.locator('.wowd-content p').first().boundingBox()
    const handle = await page.locator('[data-testid="ruler-handle-left"]').boundingBox()
    if (!before || !handle) throw new Error('位置が取れない')

    // 四角のつまみを右へ 60px ぶん引く
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2, {
      steps: 6
    })
    await page.mouse.up()
    await page.waitForTimeout(400)

    const after = await page.locator('.wowd-content p').first().boundingBox()
    if (!after) throw new Error('位置が取れない')
    // 引いた量だけ本文が右へ寄る (目盛りに吸い付くので厳密一致はしない)
    expect(after.x - before.x).toBeGreaterThan(50)
    expect(after.x - before.x).toBeLessThan(70)
  })
})

test.describe('裁ちトンボ', () => {
  test('出すと紙が四辺 13mm ずつ大きくなる', async () => {
    const plain = await pageBox()
    await setToggle('断裁位置', true)
    const trimmed = await pageBox()

    // 13mm = 49.1px (96dpi)。左右上下で 2 回ぶん
    expect(trimmed.width - plain.width).toBeGreaterThan(90)
    expect(trimmed.width - plain.width).toBeLessThan(106)
    expect(trimmed.height - plain.height).toBeGreaterThan(90)
    expect(trimmed.height - plain.height).toBeLessThan(106)
    await expect(page.locator('[data-testid="wowd-trim-marks"]').first()).toBeVisible()
  })

  /**
   * ここが肝。トンボは紙の外側に足すものなので、
   * 本文の位置が動いてはいけない。動けば改ページ位置も PDF も変わってしまう。
   */
  test('仕上がりの紙に対する本文の位置は動かない', async () => {
    await page.locator('.wowd-content').click()
    await page.keyboard.type('位置の基準にする段落')

    const beforeText = await page.locator('.wowd-content p').first().boundingBox()
    const beforePaper = await pageBox()

    await setToggle('断裁位置', true)
    const afterText = await page.locator('.wowd-content p').first().boundingBox()
    const afterPaper = await pageBox()
    if (!beforeText || !afterText) throw new Error('位置が取れない')

    // 紙そのものが四辺に広がるので、画面上の座標は動いて当たり前。
    // 見るべきは「仕上がりの角から本文までの距離」が変わっていないこと。
    // 仕上がりの角は、広がった紙の左上から広がったぶんだけ内側にある
    const offset = (afterPaper.width - beforePaper.width) / 2
    const beforeInset = { x: beforeText.x - beforePaper.x, y: beforeText.y - beforePaper.y }
    const afterInset = {
      x: afterText.x - (afterPaper.x + offset),
      y: afterText.y - (afterPaper.y + offset)
    }
    expect(Math.abs(afterInset.x - beforeInset.x)).toBeLessThan(2)
    expect(Math.abs(afterInset.y - beforeInset.y)).toBeLessThan(2)
  })

  test('紙が 2 枚でも重ならない', async () => {
    await makeTwoPages()
    await expect(page.locator('.wowd-page-backdrop')).toHaveCount(2)

    await setToggle('断裁位置', true)
    const first = await pageBox(0)
    const second = await pageBox(1)
    // 1 枚目の下端より 2 枚目の上端が下にある
    expect(second.y).toBeGreaterThan(first.y + first.height)
  })

  test('PDF の用紙もトンボぶん大きくなる', async () => {
    await page.locator('.wowd-content').click()
    await page.keyboard.type('入稿する文書')
    await setToggle('断裁位置', true)

    const target = join(workDir, 'trim.pdf')
    await page.evaluate(async (path) => {
      const print = (window as unknown as { __wowdPrint: (p: string) => Promise<unknown> })
        .__wowdPrint
      await print(path)
    }, target)

    const text = readFileSync(target).toString('latin1')
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(text)
    expect(box, 'MediaBox が見つからない').not.toBeNull()

    // A4 (595 x 842pt) + 四辺 13mm (36.85pt) ずつ = 668.7 x 915.7pt
    const width = Number(box?.[1])
    const height = Number(box?.[2])
    expect(width).toBeGreaterThan(655)
    expect(width).toBeLessThan(685)
    expect(height).toBeGreaterThan(900)
    expect(height).toBeLessThan(930)
  })

  test('出さなければ PDF の用紙は仕上がりサイズのまま', async () => {
    await page.locator('.wowd-content').click()
    await page.keyboard.type('ふだんの文書')

    const target = join(workDir, 'plain.pdf')
    await page.evaluate(async (path) => {
      const print = (window as unknown as { __wowdPrint: (p: string) => Promise<unknown> })
        .__wowdPrint
      await print(path)
    }, target)

    const text = readFileSync(target).toString('latin1')
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(text)
    const width = Number(box?.[1])
    expect(width).toBeGreaterThan(585)
    expect(width).toBeLessThan(605)
  })
})
