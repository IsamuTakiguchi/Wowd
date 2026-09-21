import { test, expect } from '@playwright/test'

/**
 * 「ホーム画面に追加」できる条件。
 *
 * manifest が読めて、サービスワーカーが登録できること。
 * どちらか欠けるとブラウザは追加の案内を出さない。
 * localhost は https と同じ扱いなので、ここで登録まで確かめられる。
 */
test.skip(({ isMobile }) => isMobile, 'PC の設定で 1 回見れば足りる')

test('manifest が配られている', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.ok()).toBe(true)
  const manifest = (await res.json()) as { name: string; icons: unknown[]; display: string }
  expect(manifest.name).toBe('Wowd')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2)
})

test('サービスワーカーが登録され、アイコンとテンプレートが取れる', async ({ page, request }) => {
  await page.goto('/')
  await page.waitForSelector('.wowd-content', { timeout: 20_000 })
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return reg.active?.state ?? 'none'
  })
  expect(['activating', 'activated']).toContain(registered)

  for (const path of ['/icon-512.png', '/templates/blank-a4.docx', '/sw.js']) {
    const res = await request.get(path)
    expect(res.ok(), path).toBe(true)
  }
  // 版番号が埋まっている (埋まっていないと更新のたびに古いキャッシュが残る)
  const sw = await (await request.get('/sw.js')).text()
  expect(sw).not.toContain('__APP_VERSION__')
})
