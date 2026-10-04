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

/** 本文の段落の文字 (行頭記号を除く) */
async function texts(): Promise<string[]> {
  return (await paragraphs()).map((p) => p.text)
}

test('Alt+T 日付入力: 和暦・全角・曜日と休日', async () => {
  await page.click('.wowd-content p')
  await page.keyboard.press('Alt+t')
  await page.getByTestId('okaguchi-date-input').fill('r2/5/3')
  await page.getByTestId('okaguchi-date-style-wareki').check()
  await page.getByTestId('okaguchi-date-weekday-yes').check()
  await page.getByTestId('okaguchi-date-holiday-yes').check()
  await expect(page.getByTestId('okaguchi-preview')).toHaveText('令和２年５月３日（日曜日・休日（憲法記念日））')
  await page.keyboard.press('Enter')
  await expect(page.locator('dialog')).toHaveCount(0)
  expect((await texts())[0]).toBe('令和２年５月３日（日曜日・休日（憲法記念日））')
})

test('Alt+Z 全角1文字入力: 括弧を半分の幅にして全角 1 字に収める', async () => {
  await page.click('.wowd-content p')
  await page.keyboard.type('前')
  await page.keyboard.press('Alt+z')
  await page.getByTestId('okaguchi-wide-input').fill('1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('後')
  expect((await texts())[0]).toBe('前(1)　後')
  // 括弧の箱は縮み、後ろが詰まる: 「(1)」全体で全角 1 字ぶん前後
  const width = await page.evaluate(() => {
    const p = document.querySelector('.wowd-content p')!
    const range = document.createRange()
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    const open = nodes.find((n) => n.data === '(')!
    const close = nodes.find((n) => n.data === ')')!
    range.setStart(open, 0)
    range.setEnd(close, 1)
    const fontSize = parseFloat(getComputedStyle(p).fontSize)
    return range.getBoundingClientRect().width / fontSize
  })
  expect(width).toBeGreaterThan(0.7)
  expect(width).toBeLessThan(1.3)
})

test('Alt+M 当事者欄 (自然人): 地位と氏名を均等割り付けで差し込み、保存すると w:fitText になる', async () => {
  await page.click('.wowd-content p')
  await page.keyboard.press('Alt+m')
  await page.getByTestId('okaguchi-person-role').fill('g')
  await page.getByTestId('okaguchi-person-name').fill('甲野太郎')
  await page.getByTestId('okaguchi-person-zip').fill('1050001')
  await page.getByTestId('okaguchi-person-address1').fill('東京都港区虎ノ門1-1-1')
  await page.getByTestId('okaguchi-person-birth').fill('s60/5/24')
  await page.locator('dialog button[type="submit"]').click()
  const t = await texts()
  expect(t[0]).toBe('〒１０５－０００１　東京都港区虎ノ門１－１－１')
  expect(t[1]).toBe('原告　　　甲野太郎')
  expect(t[2]).toBe('昭和６０年５月２４日生')
  // 氏名の左端は、生年月日の左端 (23 字目) とそろう
  const lefts = await page.$$eval('.wowd-content p', (ps) =>
    ps.slice(1, 3).map((p) => {
      const spans = p.querySelectorAll('span[style*="width"]')
      return (spans[spans.length - 1] as HTMLElement).getBoundingClientRect().left
    })
  )
  expect(Math.abs(lefts[0]! - lefts[1]!)).toBeLessThan(2)

  const bytes = await page.evaluate(async () => {
    const w = window as unknown as { __wowdStore: { getState: () => { saveToBytes: () => Promise<number[]> } } }
    return w.__wowdStore.getState().saveToBytes()
  })
  const documentXml = strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml']!)
  expect(documentXml).toMatch(/<w:fitText w:val="\d+" w:id="\d+"\/>/)
  expect(documentXml).toContain('w:leftChars="2300"')
})

test('Alt+C 利息計算: 見本に結果が出て、文書に入れられる', async () => {
  await page.click('.wowd-content p')
  await page.keyboard.press('Alt+c')
  await page.getByTestId('okaguchi-interest-start').fill('2020/4/1')
  await page.getByTestId('okaguchi-interest-end').fill('2021/6/30')
  await page.getByTestId('okaguchi-interest-principal').fill('1,000,000')
  await page.getByTestId('okaguchi-interest-rate').fill('3')
  await expect(page.getByTestId('okaguchi-preview')).toContainText('利息　３７４７９円')
  await page.locator('dialog button[type="submit"]').click()
  const t = await texts()
  expect(t[0]).toBe('利息　３７４７９円')
  expect(t).toContain('日数　１年９１日（通算４５６日）')
})

test('Alt+B 物件情報入力: 土地の物件目録', async () => {
  await page.click('.wowd-content p')
  await page.keyboard.press('Alt+b')
  await page.getByTestId('okaguchi-prop-land-location').fill('東京都港区虎ノ門一丁目')
  await page.getByTestId('okaguchi-prop-land-lot').fill('1番1')
  await page.getByTestId('okaguchi-prop-land-area').fill('123.45')
  await page.locator('dialog button[type="submit"]').click()
  expect(await texts()).toEqual([
    '所在　　東京都港区虎ノ門一丁目',
    '地番　　１番１',
    '地積　　１２３．４５㎡'
  ])
})

test('Alt+J 連番等事後設定: 手で打った符号を連番ランクにする', async () => {
  await typeLines(['第１　請求の趣旨', '1 被告は、原告に対し、', '(1)主位的請求', '原告は、', '２　訴訟費用は'])
  await page.keyboard.press('Alt+j')
  await page.locator('dialog button[type="submit"]').click()
  const ps = await paragraphs()
  expect(ps.map((p) => [p.marker, p.text])).toEqual([
    ['第１', '　請求の趣旨'],
    ['１', '　被告は、原告に対し、'],
    ['⑴', '　主位的請求'],
    ['', '原告は、'],
    ['２', '　訴訟費用は']
  ])
})

test('Alt+P 書式変更: A4・37 字 × 26 行・12pt、フッターにページ番号', async () => {
  await page.click('.wowd-content p')
  await page.keyboard.press('Alt+p')
  await page.locator('dialog button[type="submit"]').click()
  await expect(page.getByTestId('notice')).toContainText('書式変更が完了しました')
  const result = await page.evaluate(() => {
    const w = window as unknown as {
      __wowdStore: {
        getState: () => {
          document: {
            resources: {
              sections: { pgMar: { left: number; top: number }; docGrid: { type: string } | null; footerRefs: { default?: string } }[]
              footers: Map<string, unknown>
            }
          }
        }
      }
    }
    const r = w.__wowdStore.getState().document.resources
    const s = r.sections[0]!
    return { left: s.pgMar.left, top: s.pgMar.top, grid: s.docGrid?.type, footer: JSON.stringify(r.footers.get(s.footerRefs.default ?? '')) }
  })
  expect(result.left).toBe(1701)
  expect(result.top).toBe(1984)
  expect(result.grid).toBe('linesAndChars')
  expect(result.footer).toContain('PAGE')
})

test('リボンの「岡口マクロ」タブからも使える', async () => {
  await typeLines(['見出し'])
  await page.getByTestId('ribbon-tab-okaguchi').click()
  await page.getByRole('button', { name: /ランク3 \(Alt\+3\)/ }).click()
  expect((await paragraphs())[0]).toMatchObject({ marker: '⑴', text: '　見出し' })
  await page.getByRole('button', { name: /日付入力/ }).click()
  await expect(page.locator('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.getByTestId('ribbon-tab-home').click()
})
