import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'

/** Word に合わせた操作 (ファイル タブ・キー・ブラシ・段落・右クリック・ナビゲーション・リンクなど) */

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
    const w = window as unknown as {
      __wowdStore: { setState: (p: { dirty: boolean }) => void; getState: () => { newDocument: (t: string) => Promise<void> } }
    }
    w.__wowdStore.setState({ dirty: false })
    await w.__wowdStore.getState().newDocument('blank-a4')
  })
  await page.waitForFunction(() => document.querySelector('.wowd-content p') !== null)
  await page.getByTestId('ribbon-tab-home').click()
})

async function typeLines(lines: string[]): Promise<void> {
  await page.click('.wowd-content p')
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Enter')
    await page.keyboard.type(lines[i]!)
  }
}

/** i 番目の段落の [from, to) の文字を選ぶ */
async function select(i: number, from: number, to: number): Promise<void> {
  await page.evaluate(
    ([i, from, to]) => {
      const p = document.querySelectorAll('.wowd-content p')[i]!
      // 段落の中の文字の位置 → (テキストノード, そのノードでの位置)。書式で分かれていても数えられる
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          (n.parentElement?.closest('.wowd-list-marker, [contenteditable="false"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
      })
      const locate = (offset: number): [Text, number] => {
        let rest = offset
        let last: Text | null = null
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          last = n
          if (rest <= n.data.length) return [n, rest]
          rest -= n.data.length
        }
        return [last!, last!.data.length]
      }
      const range = document.createRange()
      const [startNode, startOffset] = locate(from)
      walker.currentNode = p
      const [endNode, endOffset] = locate(to)
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    },
    [i, from, to] as const
  )
  await page.waitForTimeout(50)
}

async function paragraphAttrs(i: number): Promise<Record<string, unknown>> {
  return page.evaluate((i) => {
    const w = window as unknown as {
      __wowdEditor?: { state: { doc: { child: (n: number) => { attrs: Record<string, unknown> } } } }
    }
    return JSON.parse(JSON.stringify(w.__wowdEditor?.state.doc.child(i).attrs ?? {})) as Record<string, unknown>
  }, i)
}

async function saveXml(name: string): Promise<string> {
  const bytes = await page.evaluate(async () => {
    const w = window as unknown as { __wowdStore: { getState: () => { saveToBytes: () => Promise<number[]> } } }
    return w.__wowdStore.getState().saveToBytes()
  })
  return strFromU8(unzipSync(new Uint8Array(bytes))[name]!)
}

test('「ファイル」タブが左端にあり、開く・保存・印刷がある', async () => {
  const tabs = page.locator('.ribbon-tabs [role="tab"]')
  await expect(tabs.first()).toHaveText('ファイル')
  await page.getByTestId('ribbon-tab-file').click()
  await expect(page.getByTestId('file-tab-open')).toBeVisible()
  await expect(page.getByRole('button', { name: '名前を付けて保存' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^印刷する/ })).toBeVisible()
})

test('Ctrl+Shift+> / < でフォントサイズが一覧の次 / 前へ。Ctrl+] で 1pt', async () => {
  await typeLines(['大きさ'])
  await select(0, 0, 3)
  const size = page.locator('select[title="サイズ"]')
  const before = Number(await size.first().inputValue())
  await page.keyboard.press('Control+Shift+Period')
  const after = Number(await size.first().inputValue())
  expect(after).toBeGreaterThan(before)
  await page.keyboard.press('Control+Shift+Comma')
  expect(Number(await size.first().inputValue())).toBe(before)
  await page.keyboard.press('Control+BracketRight')
  expect(Number(await size.first().inputValue())).toBe(before + 1)
})

test('Ctrl+Q で段落書式 (配置) を解除する', async () => {
  await typeLines(['中央'])
  await page.keyboard.press('Control+e')
  expect((await paragraphAttrs(0))['jc']).toBe('center')
  await page.keyboard.press('Control+q')
  expect((await paragraphAttrs(0))['jc']).toBeNull()
})

test('書式のコピー/貼り付け (ブラシ): 太字を別の語に写す', async () => {
  await typeLines(['太字 普通'])
  await select(0, 0, 2)
  await page.keyboard.press('Control+b')
  await select(0, 0, 1)
  await page.getByTestId('ribbon-format-painter').click()
  await expect(page.locator('.app')).toHaveClass(/is-format-painter/)
  await select(0, 3, 5)
  await page.locator('.wowd-content p').first().dispatchEvent('mouseup')
  await expect(page.locator('.app')).not.toHaveClass(/is-format-painter/)
  await expect(page.locator('.wowd-content p strong')).toHaveText(['太字', '普通'])
})

test('段落ダイアログ: 左インデント 3 字・最初の行 1 字・段落後 0.5 行', async () => {
  await typeLines(['段落の設定'])
  await page.getByTestId('ribbon-paragraph-dialog').click()
  await page.getByTestId('para-left').fill('3')
  await page.getByTestId('para-first').selectOption('indent')
  await page.getByTestId('para-first-width').fill('1')
  await page.getByTestId('para-before').fill('0.5')
  await page.locator('dialog button[type="submit"]').click()
  const attrs = await paragraphAttrs(0)
  expect(attrs['ind']).toMatchObject({ leftChars: 300, firstLineChars: 100 })
  expect(attrs['spacing']).toMatchObject({ beforeLines: 50 })
  expect(await saveXml('word/document.xml')).toMatch(/<w:ind [^>]*w:leftChars="300"[^>]*\/>/)
})

test('右クリックメニュー: 切り取り・コピー・貼り付けと段落', async () => {
  await typeLines(['右クリック'])
  await page.locator('.wowd-content p').first().click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /貼り付け/ })).toBeEnabled()
  await expect(menu.getByRole('menuitem', { name: /コピー/ }).first()).toBeDisabled()
  await page.getByTestId('context-paragraph').click()
  await expect(page.locator('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
})

test('切り取りと貼り付け (リボンのボタン)', async () => {
  await typeLines(['あいう'])
  await select(0, 0, 1)
  await page.locator('button[title="切り取り (Ctrl+X)"]').click()
  await expect(page.locator('.wowd-content p').first()).toHaveText('いう')
  await page.keyboard.press('End')
  await page.getByTestId('ribbon-paste').click()
  await expect(page.locator('.wowd-content p').first()).toHaveText('いうあ')
})

test('ナビゲーション ウィンドウ: 見出しの一覧から移る', async () => {
  await typeLines(['第一章', '本文', '第二章', '本文'])
  for (const i of [0, 2]) {
    await select(i, 0, 1)
    await page.keyboard.press('Alt+1')
  }
  await page.getByTestId('ribbon-tab-view').click()
  // 開閉の状態は覚えているので、閉じた状態から始める
  const toggle = page.getByTestId('ribbon-navigation')
  if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click()
  await toggle.click()
  const pane = page.getByTestId('nav-pane')
  await expect(pane.getByRole('button', { name: /第二章/ })).toBeVisible()
  await pane.getByRole('button', { name: /第二章/ }).click()
  const from = await page.evaluate(() => {
    const w = window as unknown as { __wowdEditor: { state: { selection: { $from: { parent: { textContent: string } } } } } }
    return w.__wowdEditor.state.selection.$from.parent.textContent
  })
  expect(from).toContain('第二章')
  await page.getByTestId('ribbon-navigation').click()
  await expect(pane).toHaveCount(0)
})

test('ハイパーリンク (Ctrl+K): 保存すると関係 (.rels) とリンクが書かれる', async () => {
  await typeLines(['裁判所のサイト'])
  await select(0, 0, 7)
  await page.keyboard.press('Control+k')
  await page.getByTestId('link-url').fill('www.courts.go.jp')
  await page.locator('dialog button[type="submit"]').click()
  await expect(page.locator('.wowd-content a.wowd-link')).toHaveText('裁判所のサイト')
  const documentXml = await saveXml('word/document.xml')
  const rels = await saveXml('word/_rels/document.xml.rels')
  const id = /<w:hyperlink r:id="(rId\d+)"/.exec(documentXml)?.[1]
  expect(id).toBeTruthy()
  expect(rels).toContain(`Id="${id}"`)
  expect(rels).toContain('Target="https://www.courts.go.jp" TargetMode="External"')
})

test('記号と特殊文字・ジャンプ・文字カウント', async () => {
  await typeLines(['記号'])
  await page.getByTestId('ribbon-tab-insert').click()
  await page.getByTestId('ribbon-symbol').click()
  // 「最近使った記号」にも同じ記号が出ることがあるので、どちらでもよい
  await page.getByTestId('symbol-※').first().click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.wowd-content p').first()).toHaveText('記号※')

  await page.locator('.wowd-content p').first().click()
  await page.keyboard.press('Control+g')
  await page.getByTestId('goto-page').fill('1')
  await page.locator('dialog button[type="submit"]').click()
  await expect(page.locator('dialog')).toHaveCount(0)

  await page.getByTestId('status-chars').click()
  await expect(page.getByTestId('wordcount')).toContainText('文字数 (スペースを含める)3')
  await page.keyboard.press('Escape')
})

test('段落の終わりで Enter: 次の段落のスタイルになる (ランク１ → 本文１、番号は付かない)', async () => {
  await typeLines(['請求の趣旨'])
  await page.keyboard.press('Alt+1')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('被告は')
  const result = await page.evaluate(() => {
    const w = window as unknown as {
      __wowdStore: { getState: () => { document: { resources: { styles: { byId: Map<string, { name: string }> } } } } }
    }
    const byId = w.__wowdStore.getState().document.resources.styles.byId
    return Array.from(document.querySelectorAll('.wowd-content p')).map((p) => ({
      style: byId.get(p.getAttribute('data-style') ?? '')?.name ?? '',
      marker: p.querySelector('.wowd-list-marker')?.textContent ?? ''
    }))
  })
  expect(result).toEqual([
    { style: 'ランク１', marker: '第１' },
    { style: '本文１', marker: '' }
  ])
})
