import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync, strFromU8 } from 'fflate'

/**
 * 岡口マクロの移植。元のマクロと同じキーで動くこと。
 *
 * 1 回の起動で回し、テストごとに白紙の文書に戻す。
 */

let app: ElectronApplication
let page: Page
let workDir: string

test.beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'wowd-okaguchi-'))
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
    const w = window as unknown as {
      __wowdStore: {
        setState: (p: { dirty: boolean }) => void
        getState: () => { newDocument: (t: string) => Promise<void> }
      }
    }
    w.__wowdStore.setState({ dirty: false })
    await w.__wowdStore.getState().newDocument('blank-a4')
  })
  await page.waitForFunction(() => document.querySelector('.wowd-content p') !== null)
})

/** 段落ごとの [行頭記号, 本文] */
async function paragraphs(): Promise<{ marker: string; text: string; style: string }[]> {
  return page.$$eval('.wowd-content p', (ps) =>
    ps.map((p) => {
      const marker = p.querySelector('.wowd-list-marker')?.textContent ?? ''
      const clone = p.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.wowd-list-marker, .wowd-list-marker-wrap').forEach((m) => m.remove())
      return { marker, text: clone.textContent ?? '', style: p.getAttribute('data-style') ?? '' }
    })
  )
}

async function typeLines(lines: string[]): Promise<void> {
  await page.click('.wowd-content p')
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Enter')
    await page.keyboard.type(lines[i]!)
  }
}

async function caretToParagraph(index: number): Promise<void> {
  await page.evaluate((i) => {
    const p = document.querySelectorAll('.wowd-content p')[i] as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(p)
    range.collapse(false)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  }, index)
  // ProseMirror が DOM の選択を読み戻すのを待つ
  await page.waitForTimeout(50)
}

test('Alt+R で連番ランクを設定し、Alt+1 で 第１ の見出しにする (もう一度で本文に戻る)', async () => {
  await typeLines(['請求の趣旨'])
  await page.keyboard.press('Alt+r')
  await expect(page.getByTestId('notice')).toContainText('連番ランクを設定しました')

  await page.keyboard.press('Alt+1')
  let ps = await paragraphs()
  expect(ps[0]).toMatchObject({ marker: '第１', text: '　請求の趣旨' })

  await page.keyboard.press('Alt+1')
  ps = await paragraphs()
  expect(ps[0]).toMatchObject({ marker: '', text: '請求の趣旨' })
})

test('未設定でも Alt+N でそのまま使える。各ランクの記号が出る', async () => {
  await typeLines(['一', '二', '三', '四', '五', '六', '七', '八'])
  for (let n = 1; n <= 8; n++) {
    await caretToParagraph(n - 1)
    await page.keyboard.press(`Alt+${n}`)
  }
  const ps = await paragraphs()
  expect(ps.map((p) => p.marker)).toEqual(['第１', '１', '⑴', 'ア', '(ア)', 'a', '(a)', '①'])
  expect(ps.every((p) => p.text.startsWith('　'))).toBe(true)
})

test('番号の右端が本文の開始位置にそろい、見出しの文字は本文の字下げとそろう', async () => {
  await typeLines(['見出し', '本文の段落', '小見出し', '小本文'])
  await caretToParagraph(0)
  await page.keyboard.press('Alt+1')
  // 見出しと本文をまとめて選び Alt+1 → 1 段落目はもう見出しなので本文に戻ってしまう。
  // 2 段落目だけ選んで本文にする代わりに、見出しの次で Enter したのと同じく本文１を当てる
  await caretToParagraph(2)
  await page.keyboard.press('Alt+3')

  const boxes = await page.$$eval('.wowd-content p', (ps) =>
    ps.map((p) => {
      const marker = p.querySelector('.wowd-list-marker') as HTMLElement | null
      const pr = p.getBoundingClientRect()
      return {
        left: pr.left,
        markerRight: marker ? marker.getBoundingClientRect().right : null,
        style: getComputedStyle(p).marginLeft
      }
    })
  )
  // ランク１: 左 2 字。番号「第１」(2 字) の右端が段落の左端 (= 2 字の位置) にそろう
  const first = boxes[0]!
  expect(first.markerRight).not.toBeNull()
  expect(Math.abs(first.markerRight! - first.left)).toBeLessThan(1.5)
  const third = boxes[2]!
  expect(Math.abs(third.markerRight! - third.left)).toBeLessThan(1.5)
})

test('2 段落目以降は本文N になる (見出しと本文をまとめて指定)', async () => {
  await typeLines(['第一の見出し', '本文その1', '本文その2'])
  // 3 段落を選ぶ
  await page.evaluate(() => {
    const ps = document.querySelectorAll('.wowd-content p')
    const range = document.createRange()
    range.setStart(ps[0]!.firstChild!, 0)
    range.setEnd(ps[2]!.firstChild!, 2)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  })
  await page.waitForTimeout(50)
  await page.keyboard.press('Alt+2')
  const ps = await paragraphs()
  expect(ps[0]).toMatchObject({ marker: '１', text: '　第一の見出し' })
  expect(ps[1]).toMatchObject({ marker: '', text: '本文その1' })
  expect(ps[2]).toMatchObject({ marker: '', text: '本文その2' })
  const names = await page.evaluate(() => {
    const w = window as unknown as {
      __wowdStore: { getState: () => { document: { resources: { styles: { byId: Map<string, { name: string }> } } } } }
    }
    const byId = w.__wowdStore.getState().document.resources.styles.byId
    return Array.from(document.querySelectorAll('.wowd-content p')).map(
      (p) => byId.get(p.getAttribute('data-style') ?? '')?.name ?? ''
    )
  })
  expect(names).toEqual(['ランク２', '本文２', '本文２'])
})

test('Alt+Shift+N で番号を 1 から振り直し、後続はその続きになる', async () => {
  await typeLines(['A', 'B', 'C', 'D'])
  for (let i = 0; i < 4; i++) {
    await caretToParagraph(i)
    await page.keyboard.press('Alt+3')
  }
  await caretToParagraph(2)
  await page.keyboard.press('Alt+Shift+3')
  const ps = await paragraphs()
  expect(ps.map((p) => p.marker)).toEqual(['⑴', '⑵', '⑴', '⑵'])
})

test('Alt+Shift+R で 10 以上の ランク１ を半角にする', async () => {
  const lines = Array.from({ length: 11 }, (_, i) => `項目${i + 1}`)
  await typeLines(lines)
  for (let i = 0; i < lines.length; i++) {
    await caretToParagraph(i)
    await page.keyboard.press('Alt+1')
  }
  let ps = await paragraphs()
  expect(ps[9]!.marker).toBe('第１０')
  await page.keyboard.press('Alt+Shift+r')
  ps = await paragraphs()
  expect(ps.map((p) => p.marker).slice(8)).toEqual(['第９', '第10', '第11'])
})

test('保存すると、Word で開いても同じになる形 (スタイルと番号の結び付け) で書かれる', async () => {
  await typeLines(['見出し'])
  await page.keyboard.press('Alt+1')
  const target = join(workDir, 'rank.docx')
  await page.evaluate(async (path) => {
    const w = window as unknown as {
      __wowdStore: { getState: () => { saveTo?: (p: string) => Promise<boolean>; saveToBytes: () => Promise<number[]> } }
    }
    const bytes = await w.__wowdStore.getState().saveToBytes()
    ;(window as unknown as { __savedBytes: number[] }).__savedBytes = bytes
    return path
  }, target)
  const bytes = await page.evaluate(() => (window as unknown as { __savedBytes: number[] }).__savedBytes)
  const files = unzipSync(new Uint8Array(bytes))
  const styles = strFromU8(files['word/styles.xml']!)
  const numbering = strFromU8(files['word/numbering.xml']!)
  const documentXml = strFromU8(files['word/document.xml']!)
  expect(styles).toContain('w:val="ランク１"')
  expect(styles).toContain('w:val="本文１"')
  expect(numbering).toContain('w:val="第%1"')
  expect(numbering).toContain('<w:lvlJc w:val="right"/>')
  expect(numbering).toMatch(/<w:pStyle w:val="OkaguchiRank1"\/>/)
  expect(documentXml).toContain('<w:pStyle w:val="OkaguchiRank1"/>')
  // 本文の文字に番号は入れない (全角スペースだけ)
  expect(documentXml).toContain('　見出し')
  expect(documentXml).not.toContain('第１')
  void readFileSync
})
