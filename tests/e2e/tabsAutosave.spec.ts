import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync, strFromU8 } from 'fflate'

/**
 * 文書のタブ (Excel のシート見出し) と、自動保存 (元のファイルへの上書き)。
 *
 * 1 回の起動で全部回す。テストごとに起動し直すと遅いので、
 * 前のテストのタブを閉じて 1 枚に戻してから始める。
 */

let app: ElectronApplication
let page: Page
let workDir: string

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'docx', '01-plain.docx')

test.beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'wowd-tabs-'))
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
  // 自動保存はオフから始める。設定は localStorage に残るので毎回そろえる
  await setAutoSave(false)
  // タブを 1 枚の白紙に戻す。未保存の確認を出さないよう、印を落としてから閉じる
  await page.evaluate(async () => {
    const w = window as unknown as {
      __wowdTabs: {
        getState: () => {
          tabs: { id: string }[]
          activeId: string
          parked: Map<string, { data: { dirty: boolean } }>
          updateParked: (id: string, p: { dirty: boolean }) => void
          closeOthers: (id: string) => Promise<void>
        }
      }
      __wowdStore: {
        setState: (p: { dirty: boolean }) => void
        getState: () => { newDocument: (t: string) => Promise<void> }
      }
    }
    const tabs = w.__wowdTabs.getState()
    for (const id of tabs.parked.keys()) tabs.updateParked(id, { dirty: false })
    w.__wowdStore.setState({ dirty: false })
    await tabs.closeOthers(tabs.activeId)
    await w.__wowdStore.getState().newDocument('blank-a4')
  })
  await expect(page.locator('.tabbar-tab')).toHaveCount(1)
})

async function titles(): Promise<string[]> {
  return page.locator('.tabbar-tab .tabbar-title').allTextContents()
}

async function bodyText(): Promise<string> {
  return (await page.locator('.wowd-content').innerText()).trim()
}

async function typeBody(text: string): Promise<void> {
  await page.locator('.wowd-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
}

/** 自動保存を目的の状態にする。押すだけだと前の実行の状態で反転する */
async function setAutoSave(on: boolean): Promise<void> {
  const toggle = page.locator('[data-testid="autosave-toggle"]')
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(on))
}

/** フィクスチャを作業用の場所へ写し、実ファイルとして開く */
async function openCopy(name: string): Promise<string> {
  const path = join(workDir, name)
  copyFileSync(FIXTURE, path)
  await page.evaluate(async (p) => {
    const tabs = (window as unknown as { __wowdTabs: { getState: () => { openPath: (p: string) => Promise<void> } } })
      .__wowdTabs
    await tabs.getState().openPath(p)
  }, path)
  await expect(page.locator('.tabbar-tab.is-active .tabbar-title')).toHaveText(name)
  return path
}

/** ディスク上の .docx の本文 XML */
function documentXml(path: string): string {
  const files = unzipSync(new Uint8Array(readFileSync(path)))
  const xml = files['word/document.xml']
  if (!xml) throw new Error('document.xml が無い')
  return strFromU8(xml)
}

test.describe('タブ', () => {
  test('起動時は「文書1」のような名前の白紙が 1 枚', async () => {
    const [first] = await titles()
    expect(first).toMatch(/^文書\d+$/)
  })

  test('＋で新しいタブが開き、通し番号の名前が付く', async () => {
    await page.locator('[data-testid="tab-add"]').click()
    await expect(page.locator('.tabbar-tab')).toHaveCount(2)
    const [a, b] = await titles()
    expect(a).not.toBe(b)
    expect(b).toMatch(/^文書\d+$/)
    // 新しいタブは白紙で、それが表に出ている
    await expect(page.locator('.tabbar-tab').nth(1)).toHaveAttribute('aria-selected', 'true')
    expect(await bodyText()).toBe('')
  })

  test('切り替えても各タブの内容が保たれる', async () => {
    await typeBody('一枚目の内容')
    await page.locator('[data-testid="tab-add"]').click()
    await typeBody('二枚目の内容')

    await page.locator('[data-testid="tab-0"]').click()
    await expect(page.locator('.wowd-content')).toContainText('一枚目の内容')
    await expect(page.locator('.wowd-content')).not.toContainText('二枚目の内容')

    await page.locator('[data-testid="tab-1"]').click()
    await expect(page.locator('.wowd-content')).toContainText('二枚目の内容')
  })

  /** 切り替えのたびに作り直していると、ここが壊れる */
  test('切り替えをまたいでも「元に戻す」が効く', async () => {
    await typeBody('取り消す文字')
    await page.locator('[data-testid="tab-add"]').click()
    await page.locator('[data-testid="tab-0"]').click()
    await expect(page.locator('.wowd-content')).toContainText('取り消す文字')

    await page.locator('.wowd-content').click()
    await page.keyboard.press('Control+z')
    await expect(page.locator('.wowd-content')).not.toContainText('取り消す文字')
  })

  test('Ctrl+PageDown / Ctrl+PageUp で前後のタブへ回る (Excel と同じ)', async () => {
    await page.locator('[data-testid="tab-add"]').click()
    await page.locator('[data-testid="tab-add"]').click()
    await expect(page.locator('.tabbar-tab').nth(2)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Control+PageDown')
    // 端からは反対側へ回る
    await expect(page.locator('.tabbar-tab').nth(0)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Control+PageUp')
    await expect(page.locator('.tabbar-tab').nth(2)).toHaveAttribute('aria-selected', 'true')
  })

  test('手つかずの白紙のタブにファイルを開くと、そのタブに入る', async () => {
    await openCopy('in-place.docx')
    await expect(page.locator('.tabbar-tab')).toHaveCount(1)
  })

  test('編集中のタブがあると、ファイルは新しいタブに開く', async () => {
    await typeBody('編集中')
    await openCopy('new-tab.docx')
    await expect(page.locator('.tabbar-tab')).toHaveCount(2)
  })

  test('同じファイルを二度開くと、開いているタブへ移るだけ', async () => {
    const path = await openCopy('twice.docx')
    await page.locator('[data-testid="tab-add"]').click()
    await expect(page.locator('.tabbar-tab')).toHaveCount(2)

    await page.evaluate(async (p) => {
      const tabs = (window as unknown as { __wowdTabs: { getState: () => { openPath: (p: string) => Promise<void> } } })
        .__wowdTabs
      await tabs.getState().openPath(p)
    }, path)
    await expect(page.locator('.tabbar-tab')).toHaveCount(2)
    await expect(page.locator('.tabbar-tab.is-active .tabbar-title')).toHaveText('twice.docx')
  })

  test('× で閉じると、隣のタブが表に出る', async () => {
    await page.locator('[data-testid="tab-add"]').click()
    await typeBody('残るタブ')
    await page.evaluate(() => {
      ;(window as unknown as { __wowdStore: { setState: (p: { dirty: boolean }) => void } }).__wowdStore.setState({
        dirty: false
      })
    })
    await page.locator('[data-testid="tab-0"]').click()
    await page.locator('[data-testid="tab-close-0"]').click()
    await expect(page.locator('.tabbar-tab')).toHaveCount(1)
    await expect(page.locator('.wowd-content')).toContainText('残るタブ')
  })

  test('最後の 1 枚を閉じると白紙に戻る (0 枚にはしない)', async () => {
    await page.locator('[data-testid="tab-close-0"]').click()
    await expect(page.locator('.tabbar-tab')).toHaveCount(1)
    expect(await bodyText()).toBe('')
  })

  test('ダブルクリックで名前を変えられる (未保存の文書)', async () => {
    await page.locator('[data-testid="tab-0"]').dblclick()
    const field = page.locator('[data-testid="tab-rename"]')
    await field.fill('準備書面(1)')
    await field.press('Enter')
    await expect(page.locator('.tabbar-tab .tabbar-title').first()).toHaveText('準備書面(1)')
  })

  test('ファイル名に使えない文字の名前は受け付けない', async () => {
    const before = (await titles())[0]
    await page.locator('[data-testid="tab-0"]').dblclick()
    const field = page.locator('[data-testid="tab-rename"]')
    await field.fill('a/b')
    await field.press('Enter')
    await expect(page.locator('.tabbar-tab .tabbar-title').first()).toHaveText(before ?? '')
  })

  test('ドラッグで並べ替えられる', async () => {
    await page.locator('[data-testid="tab-add"]').click()
    const [a, b] = await titles()
    await page.locator('[data-testid="tab-1"]').dragTo(page.locator('[data-testid="tab-0"]'))
    expect(await titles()).toEqual([b, a])
  })

  test('右クリックからタブの色を付けられる', async () => {
    await page.locator('[data-testid="tab-0"]').click({ button: 'right' })
    await expect(page.locator('[data-testid="tab-menu"]')).toBeVisible()
    await page.locator('[data-testid="tab-menu"] [aria-label="緑"]').click()
    const style = await page.locator('[data-testid="tab-0"]').getAttribute('style')
    expect(style).toContain('--tab-color')
  })

  /** 表の文書だけ見ていると、裏のタブの編集を黙って捨てて終了してしまう */
  test('終了の確認は、裏に回したタブの未保存も数える', async () => {
    await typeBody('裏に回す編集')
    await page.locator('[data-testid="tab-add"]').click()
    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __wowdStore: { getState: () => { dirty: boolean } }
        __wowdTabs: { getState: () => { anyDirty: () => boolean } }
      }
      return { activeDirty: w.__wowdStore.getState().dirty, any: w.__wowdTabs.getState().anyDirty() }
    })
    expect(result.activeDirty).toBe(false)
    expect(result.any).toBe(true)
  })
})

test.describe('自動保存', () => {
  test('オンにすると、編集が止まって少したつと元のファイルへ書く', async () => {
    const path = await openCopy('auto-on.docx')
    await setAutoSave(true)
    await typeBody('自動で保存される文字')

    await expect.poll(() => documentXml(path).includes('自動で保存される文字'), { timeout: 15_000 }).toBe(true)
    await expect(page.locator('[data-testid="autosave-status"]')).toHaveText('保存済み')
    await expect(page.locator('.tabbar-dirty')).toHaveCount(0)
  })

  test('オフなら書かない', async () => {
    const path = await openCopy('auto-off.docx')
    const before = statSync(path).mtimeMs
    await typeBody('書かれない文字')
    await page.waitForTimeout(4_000)
    expect(statSync(path).mtimeMs).toBe(before)
    expect(documentXml(path)).not.toContain('書かれない文字')
  })

  test('打ってすぐ別のタブへ移っても、裏に回したタブを書く', async () => {
    const path = await openCopy('auto-parked.docx')
    await setAutoSave(true)
    await typeBody('裏で保存される文字')
    // 待たずに切り替える
    await page.locator('[data-testid="tab-add"]').click()

    await expect.poll(() => documentXml(path).includes('裏で保存される文字'), { timeout: 15_000 }).toBe(true)
    // 書いたら、裏のタブの未保存の印も消える
    await expect(page.locator('.tabbar-tab').nth(0).locator('.tabbar-dirty')).toHaveCount(0)
  })

  test('保存場所の無い文書では、保存すると始まると知らせる', async () => {
    await openCopy('auto-untitled.docx')
    await setAutoSave(true)
    await page.locator('[data-testid="tab-add"]').click()
    await expect(page.locator('[data-testid="autosave-status"]')).toHaveText('保存すると自動保存が始まります')
  })
})

test.describe('Excel に近づけた操作', () => {
  test('右クリック →「コピーを作成」で、未保存の複製が右隣にできる (中身は別物)', async () => {
    await typeBody('元の文書')
    await page.locator('.tabbar-tab').first().click({ button: 'right' })
    await page.getByTestId('tab-duplicate').click()
    await expect(page.locator('.tabbar-tab')).toHaveCount(2)
    const [first, second] = await titles()
    expect(second).toBe(`${first} (2)`)
    await expect(page.locator('.tabbar-tab').nth(1)).toHaveClass(/is-active/)
    expect(await bodyText()).toContain('元の文書')
    // 複製に足しても元は変わらない
    await typeBody('だけ')
    await page.locator('.tabbar-tab').first().click()
    expect(await bodyText()).not.toContain('だけ')
  })

  test('Ctrl+Tab / Ctrl+Shift+Tab で移り、Ctrl+W で閉じる', async () => {
    await page.locator('[data-testid="tab-add"]').click()
    await page.locator('[data-testid="tab-add"]').click()
    await expect(page.locator('.tabbar-tab')).toHaveCount(3)
    await page.locator('.wowd-content').click()
    await page.keyboard.press('Control+Tab')
    await expect(page.locator('.tabbar-tab').nth(0)).toHaveClass(/is-active/)
    await page.keyboard.press('Control+Shift+Tab')
    await expect(page.locator('.tabbar-tab').nth(2)).toHaveClass(/is-active/)
    await page.keyboard.press('Control+w')
    await expect(page.locator('.tabbar-tab')).toHaveCount(2)
  })

  test('≡ でタブの一覧を出し、名前から移る', async () => {
    await page.locator('[data-testid="tab-add"]').click()
    const [first] = await titles()
    await page.getByTestId('tab-list').click()
    const menu = page.getByTestId('tab-list-menu')
    await expect(menu.getByRole('menuitemradio')).toHaveCount(2)
    await menu.getByRole('menuitemradio', { name: new RegExp(`^${first}`) }).click()
    await expect(page.locator('.tabbar-tab').nth(0)).toHaveClass(/is-active/)
    await expect(menu).toHaveCount(0)
  })

  test('ステータスバー: 選んだ文字数、− ＋ と倍率の選択、表示の切り替え', async () => {
    await typeBody('あいうえお')
    await page.keyboard.press('Shift+Home')
    await expect(page.getByTestId('selection-count')).toHaveText('選択: 5 文字')

    await page.getByTestId('zoom-readout').click()
    await page.getByTestId('zoom-menu').getByRole('menuitemradio', { name: '75%' }).click()
    await expect(page.getByTestId('zoom-readout')).toHaveText('75%')
    // 次の 10 の倍数へ (Word の拡大・縮小ボタンと同じ)
    await page.getByTestId('zoom-in').click()
    await expect(page.getByTestId('zoom-readout')).toHaveText('80%')
    await page.getByTestId('zoom-out').click()
    await page.getByTestId('zoom-out').click()
    await expect(page.getByTestId('zoom-readout')).toHaveText('60%')

    await page.getByTestId('status-view-draft').click()
    await expect(page.locator('.wowd-viewport')).toHaveAttribute('data-view-mode', 'draft')
    await page.getByTestId('status-view-print').click()
    await expect(page.locator('.wowd-viewport')).toHaveAttribute('data-view-mode', 'print')
    await page.getByTestId('zoom-fit').click()
  })

  test('Ctrl+ホイールで拡大縮小', async () => {
    await page.getByTestId('zoom-readout').click()
    await page.getByTestId('zoom-menu').getByRole('menuitemradio', { name: '100%' }).click()
    await page.locator('.wowd-viewport').hover()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Control')
    await expect(page.getByTestId('zoom-readout')).toHaveText('110%')
    await page.getByTestId('zoom-fit').click()
  })

  test('クイック アクセス: 元に戻す・やり直し', async () => {
    await typeBody('取り消す')
    await expect(page.getByTestId('qat-undo')).toBeEnabled()
    await page.getByTestId('qat-undo').click()
    expect(await bodyText()).not.toContain('取り消す')
    await page.getByTestId('qat-redo').click()
    expect(await bodyText()).toContain('取り消す')
  })
})
