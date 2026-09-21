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

/**
 * ホーム画面のアイコンから起動できること。
 *
 * **この 1 件は実害から生まれた。** manifest への link を HTML に直接書いたところ、
 * Vite が資産として扱い assets/ にハッシュ付きで移した。
 * start_url と icons は **manifest 自身の場所**を基準に解決されるので、
 * 起動先が /assets/ になり、ホーム画面のアイコンから開くと 404 になった。
 * 画面から開く分には何ともないので、上の「manifest が配られている」も素通りした。
 *
 * ファイルが在ることではなく、**画面が指している manifest の start_url を実際にたどって
 * アプリが起動するか**を見る。
 */
test('画面が指す manifest の start_url がアプリに着く', async ({ page, request }) => {
  await page.goto('/')
  await page.waitForSelector('.wowd-content', { timeout: 20_000 })

  const href = await page.getAttribute('link[rel="manifest"]', 'href')
  expect(href, 'manifest への link が無い').not.toBeNull()
  const manifestUrl = new URL(href as string, page.url())

  // assets/ に移されていたらこの時点で分かる。
  // 移されたものは中身が同じでも、相対指定の基準が変わって壊れる
  expect(manifestUrl.pathname, 'manifest が入口と同じ階層に無い').toBe('/manifest.webmanifest')

  const manifest = (await (await request.get(manifestUrl.href)).json()) as {
    start_url: string
    scope: string
    icons: { src: string }[]
  }

  // start_url も icons も manifest の場所を基準に解決される
  for (const relative of [manifest.start_url, manifest.scope, ...manifest.icons.map((i) => i.src)]) {
    const resolved = new URL(relative, manifestUrl)
    const res = await request.get(resolved.href)
    expect(res.ok(), `${relative} が ${resolved.pathname} に解決され、取得できない`).toBe(true)
  }

  // 起動先が本当にアプリを立ち上げるところまで見る
  await page.goto(new URL(manifest.start_url, manifestUrl).href)
  await expect(page.locator('.wowd-content')).toBeVisible({ timeout: 20_000 })
})
