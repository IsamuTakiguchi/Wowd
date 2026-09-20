/**
 * アプリアイコンを生成する。
 *
 * 使い方: npx tsx scripts/make-icon.ts
 *
 * 画像を直接リポジトリに置くのではなく、SVG から起こす。
 * 直したいときに SVG を 1 行変えれば全サイズが揃うため。
 * 変換は Chromium (Playwright) に任せる。
 * ImageMagick や rsvg は環境に無いことがあるが、Chromium は e2e で既に要る。
 *
 * electron-builder は 1024x1024 の PNG があれば
 * Windows の .ico と macOS の .icns を自分で起こす。
 * したがって置くのは resources/icon.png の 1 枚でよい。
 */
import { chromium, type Browser } from '@playwright/test'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { globSync } from 'node:fs'

const OUT_DIR = join(process.cwd(), 'resources')

/**
 * 意匠。
 *
 * 小さく表示されたときに形で分かることを優先する。
 * 16px では文字は読めないので、文字を主役にしない。
 *
 * - 角丸の藍色の下地 … 日本語の文書という色味
 * - 白い紙 … 文書エディタであること
 * - 右端の朱線 … 校閲 (変更履歴・コメント) が本領であること
 */
function svg(size: number): string {
  const s = size
  // 紙の位置。下地の余白を 18% 取る
  const px = s * 0.2
  const py = s * 0.14
  const pw = s - px * 2
  const ph = s - py * 2
  const line = (i: number): string => {
    const y = py + ph * (0.24 + i * 0.16)
    const w = pw * (i === 3 ? 0.42 : 0.62)
    return `<rect x="${px + pw * 0.14}" y="${y}" width="${w}" height="${s * 0.045}" rx="${s * 0.022}" fill="#3E5C97" opacity="0.85"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2F4F8F"/>
      <stop offset="1" stop-color="#1E3566"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${s * 0.012}" stdDeviation="${s * 0.016}" flood-color="#0B1A38" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${s}" height="${s}" rx="${s * 0.22}" fill="url(#bg)"/>
  <g filter="url(#sh)">
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${s * 0.035}" fill="#FFFFFF"/>
  </g>
  ${[0, 1, 2, 3].map(line).join('\n  ')}
  <rect x="${px + pw * 0.82}" y="${py + ph * 0.12}" width="${s * 0.035}" height="${ph * 0.76}" rx="${s * 0.017}" fill="#C8382F"/>
</svg>`
}

/**
 * Chromium を起こす。
 *
 * まず Playwright の既定を試し、駄目なら入っている実体を探す。
 * このリポジトリの e2e は Electron を直接起動するので、
 * Playwright 付属の Chromium が入っていない環境がある
 * (PLAYWRIGHT_BROWSERS_PATH に別版だけがある場合など)。
 */
async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ args: ['--no-sandbox'] })
  } catch (err) {
    const root = process.env['PLAYWRIGHT_BROWSERS_PATH']
    const found = root
      ? globSync(join(root, 'chromium*', 'chrome-linux', 'chrome')).find((p) => existsSync(p))
      : undefined
    if (!found) throw err
    console.log(`  Chromium: ${found}`)
    return chromium.launch({ executablePath: found, args: ['--no-sandbox'] })
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  const browser = await launch()

  // 1024 は macOS の .icns が要る最大。ここから全サイズが起こせる
  for (const size of [1024, 512, 256]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1
    })
    const markup = svg(size)
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${markup}</body></html>`
    )
    const png = await page.screenshot({ omitBackground: true })
    const name = size === 1024 ? 'icon.png' : `icon-${size}.png`
    writeFileSync(join(OUT_DIR, name), png)
    console.log(`  ${name}  (${size}x${size}, ${png.length} bytes)`)
    await page.close()
  }

  // SVG も残す。直すのはこちら
  writeFileSync(join(OUT_DIR, 'icon.svg'), svg(1024))
  console.log('  icon.svg  (原本。直すときはこれを編集して作り直す)')

  await browser.close()
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
