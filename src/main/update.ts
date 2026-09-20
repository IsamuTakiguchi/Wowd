import { app, dialog, shell, net } from 'electron'

/**
 * 新しい版が出ていないかを確かめる。
 *
 * **自動では走らせない。** メニューから明示的に選んだときだけ問い合わせる。
 * 起動のたびに黙って外部へ接続するのは、利用者が選ぶべきことなので。
 *
 * 落とし込みまではしない。未署名の実行ファイルを自動で差し替えると、
 * Windows は SmartScreen が警告し、macOS は Gatekeeper が起動を止める。
 * 署名証明書が用意できるまでは、**知らせて配布ページを開く**ところまでにする。
 * 手順は docs/release.md にある。
 */

const RELEASES_API = 'https://api.github.com/repos/IsamuTakiguchi/Wowd/releases/latest'
const RELEASES_PAGE = 'https://github.com/IsamuTakiguchi/Wowd/releases'

/** "1.2.3" の比較。前置きの v は落とす */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split(/[.+-]/)
      .map((n) => Number.parseInt(n, 10))
      .map((n) => (Number.isFinite(n) ? n : 0))
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export interface UpdateCheck {
  kind: 'current' | 'available' | 'unavailable'
  latest?: string
  reason?: string
}

/** GitHub のリリースを 1 つ引く。失敗は例外にせず理由として返す */
export async function fetchLatest(url: string = RELEASES_API): Promise<UpdateCheck> {
  try {
    const res = await net.fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Wowd' }
    })
    if (res.status === 404) {
      // 非公開リポジトリか、まだリリースが 1 つも無い
      return { kind: 'unavailable', reason: '公開されている版が見つかりませんでした' }
    }
    if (!res.ok) return { kind: 'unavailable', reason: `応答が ${String(res.status)} でした` }

    const body = (await res.json()) as { tag_name?: unknown }
    const tag = typeof body.tag_name === 'string' ? body.tag_name : null
    if (!tag) return { kind: 'unavailable', reason: '版の名前を読み取れませんでした' }

    return compareVersions(tag, app.getVersion()) > 0
      ? { kind: 'available', latest: tag }
      : { kind: 'current', latest: tag }
  } catch (err) {
    return { kind: 'unavailable', reason: err instanceof Error ? err.message : '通信に失敗しました' }
  }
}

/** メニューから呼ぶ。結果をダイアログで知らせる */
export async function checkForUpdates(): Promise<void> {
  const result = await fetchLatest()
  const version = app.getVersion()

  if (result.kind === 'available') {
    const answer = await dialog.showMessageBox({
      type: 'info',
      title: '更新の確認',
      message: `新しい版があります (${result.latest ?? ''})`,
      detail: `お使いの版: ${version}\n\n配布ページを開きますか。`,
      buttons: ['配布ページを開く', '閉じる'],
      defaultId: 0,
      cancelId: 1
    })
    if (answer.response === 0) await shell.openExternal(RELEASES_PAGE)
    return
  }

  await dialog.showMessageBox({
    type: result.kind === 'current' ? 'info' : 'warning',
    title: '更新の確認',
    message: result.kind === 'current' ? 'お使いの版が最新です' : '確認できませんでした',
    detail:
      result.kind === 'current'
        ? `お使いの版: ${version}`
        : `${result.reason ?? ''}\n\nお使いの版: ${version}`,
    buttons: ['閉じる']
  })
}
