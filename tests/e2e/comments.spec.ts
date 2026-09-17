import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  await page.waitForTimeout(500)
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

async function openPane(): Promise<void> {
  await page.locator('button[role="tab"]', { hasText: '校閲' }).click()
  const button = page.locator('button[title="コメントの一覧を開閉する"]')
  if ((await page.locator('.comments-pane').count()) === 0) await button.click()
  await expect(page.locator('.comments-pane')).toBeVisible()
}

test('コメント付きの文書を開くとスレッドが表示される', async () => {
  await openFixture('14-comments.docx')
  await openPane()

  await expect(page.locator('[data-testid="comment-count"]')).toContainText('3 件')

  // スレッドは 2 本 (返信つき 1 本 + 単独 1 本)
  await expect(page.locator('.comment-thread')).toHaveCount(2)
  await expect(page.locator('.comments-pane')).toContainText('ここは検討が必要です。')
  await expect(page.locator('.comments-pane')).toContainText('校閲者A')

  // 返信が同じスレッドに入っている
  const withReply = page.locator('.comment-thread', { hasText: 'ここは検討が必要です。' })
  await expect(withReply.locator('.comment-item')).toHaveCount(2)
  await expect(withReply).toContainText('同意します。修正しました。')

  // 解決済みは薄く表示される
  await expect(page.locator('.comment-thread.is-done')).toHaveCount(1)
})

test('本文のコメント範囲が強調表示される', async () => {
  // 範囲は複数のランにまたがりうるので、2 か所以上あることだけを見る
  expect(await page.locator('.wowd-content .wowd-comment').count()).toBeGreaterThanOrEqual(2)
})

/**
 * 本文を全選択する。
 *
 * クリック直後に Ctrl+A を送ると選択が取り消される。ProseMirror は
 * クリックによる選択の変化を DOM から非同期に読み戻すので、
 * その読み戻しが後から全選択を上書きしてしまうため。
 * 人の操作では起きない速さだが、自動操作では毎回起きうるので落ち着くまで待つ。
 */
async function selectWholeBody(): Promise<void> {
  await expect(async () => {
    await page.locator('.wowd-content p').first().click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(100)
    await expect(page.locator('[data-testid="comment-add"]')).toBeEnabled({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
}

/** 空の文書にコメントを 1 件付ける */
async function addFirstComment(text: string): Promise<void> {
  await openFixture('01-plain.docx')
  await openPane()
  await expect(page.locator('.comment-thread')).toHaveCount(0)
  // 選択の有無はボタンの有効無効で見るので、先に本文を書いておく
  await page.locator('[data-testid="comment-draft"]').fill(text)
  await selectWholeBody()
  await page.locator('[data-testid="comment-add"]').click()
  await expect(page.locator('.comment-thread')).toHaveCount(1)
}

test('新しいコメントを追加できる', async () => {
  await openFixture('01-plain.docx')
  await openPane()
  await expect(page.locator('[data-testid="comment-count"]')).toContainText('コメントなし')

  // 本文を書いても、範囲を選ばないと追加できない
  await page.locator('[data-testid="comment-draft"]').fill('ここを確認してください。')
  await expect(page.locator('[data-testid="comment-add"]')).toBeDisabled()

  await selectWholeBody()
  await page.locator('[data-testid="comment-add"]').click()

  await expect(page.locator('.comment-thread')).toHaveCount(1)
  await expect(page.locator('.comments-pane')).toContainText('ここを確認してください。')
  await expect(page.locator('.wowd-content .wowd-comment').first()).toBeVisible()
})

test('追加したコメントが保存して開き直しても残る', async () => {
  await addFirstComment('ここを確認してください。')
  await saveAndReopen()
  await openPane()

  await expect(page.locator('.comment-thread')).toHaveCount(1)
  await expect(page.locator('.comments-pane')).toContainText('ここを確認してください。')
  // 範囲は複数のランにまたがるので、span の数ではなく存在を見る
  expect(await page.locator('.wowd-content .wowd-comment').count()).toBeGreaterThan(0)
})

test('返信がスレッドとして保存され、開き直しても残る', async () => {
  await addFirstComment('確認をお願いします。')

  await page.locator('.comment-thread button', { hasText: '返信' }).click()
  await page.locator('[data-testid="comment-draft"]').fill('確認しました。')
  await page.locator('[data-testid="comment-add"]').click()
  await expect(page.locator('.comment-thread .comment-item')).toHaveCount(2)

  await saveAndReopen()
  await openPane()

  // 2 件が 1 本のスレッドにまとまったまま残ること。
  // w14:paraId を失うと Word 側でも返信関係が壊れるので、ここが要所
  await expect(page.locator('.comment-thread')).toHaveCount(1)
  await expect(page.locator('.comment-thread .comment-item')).toHaveCount(2)
  await expect(page.locator('.comments-pane')).toContainText('確認しました。')
})

test('解決の状態が保存され、開き直しても残る', async () => {
  await addFirstComment('解決の確認用。')

  await page.locator('.comment-thread button', { hasText: '解決' }).click()
  await expect(page.locator('.comment-thread.is-done')).toHaveCount(1)

  await saveAndReopen()
  await openPane()
  await expect(page.locator('.comment-thread.is-done')).toHaveCount(1)
})

test('コメントを削除できる', async () => {
  await addFirstComment('削除の確認用。')

  await page.locator('.comment-thread button', { hasText: '削除' }).click()
  await expect(page.locator('.comment-thread')).toHaveCount(0)
  await expect(page.locator('[data-testid="comment-count"]')).toContainText('コメントなし')
})
