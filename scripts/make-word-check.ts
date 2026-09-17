/**
 * 実機 Word での確認用ファイルを生成する。
 *
 * 使い方: npm run build && npm run word-check
 *
 * コア層を直接叩くのではなく、Playwright で実アプリを起動して操作する。
 * ProseMirror を経由する保存経路 (toWowdDoc) まで含めて実物と同じにするため。
 * ここを省くと「スクリプトでは通るがアプリでは壊れる」を見逃す。
 *
 * 出力する各文書には、確認してほしいことを本文に日本語で書いておく。
 * Word で開いた瞬間に何を見ればよいか分かり、
 * チェックリストと画面を往復せずに済む。
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { readDocx } from '../src/core/docx/read'
import { parseXml } from '../src/core/docx/xml'

const OUT_DIR = join(process.cwd(), 'word-check')
const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'docx')
const SAMPLE_PNG = join(process.cwd(), 'tests', 'fixtures', 'sample.png')

/** 画面の更新とページ分割が落ち着くまでの待ち */
const SETTLE_MS = 600

interface Store {
  newDocument: (t: string) => Promise<void>
  openBytes: (b: Uint8Array, p: string | null) => Promise<void>
  saveToBytes: () => Promise<number[]>
}

declare global {
  interface Window {
    __wowdStore: { getState: () => Store }
    /** preload が公開する API。ここで使うのは復元の掃除だけ */
    wowd: { clearRecovery: () => Promise<void> }
  }
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(SETTLE_MS)
}

async function newDoc(page: Page): Promise<void> {
  await page.evaluate(() => window.__wowdStore.getState().newDocument('blank-a4'))
  await settle(page)
}

async function openFixture(page: Page, name: string): Promise<void> {
  const bytes = Array.from(new Uint8Array(readFileSync(join(FIXTURE_DIR, name))))
  await page.evaluate(
    async (data) => window.__wowdStore.getState().openBytes(new Uint8Array(data), null),
    bytes
  )
  await settle(page)
}

async function save(page: Page, name: string): Promise<void> {
  const bytes = await page.evaluate(() => window.__wowdStore.getState().saveToBytes())
  if (bytes.length === 0) throw new Error(`${name}: 保存できなかった`)
  writeFileSync(join(OUT_DIR, name), new Uint8Array(bytes))
  console.log(`  ${name}  (${bytes.length} bytes)`)
}

/**
 * 本文の先頭にカーソルを置く。
 *
 * クリック直後にキー操作を送ると取りこぼす。ProseMirror がクリックによる
 * 選択の変化を DOM から非同期に読み戻すので、その読み戻しが後から
 * 上書きしてしまう。人の操作では起きない速さだが、自動操作では毎回起きる。
 */
async function caretAtStart(page: Page): Promise<void> {
  await page.locator('.wowd-content p').first().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+Home')
  await page.waitForTimeout(100)
}

/** 確認事項を本文に書く。1 要素 1 段落 */
async function typeGuide(page: Page, lines: string[]): Promise<void> {
  await caretAtStart(page)
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Enter')
    await page.keyboard.type(lines[i]!)
  }
}

async function tab(page: Page, label: string): Promise<void> {
  await page.locator('button[role="tab"]', { hasText: label }).click()
}

async function setTracking(page: Page, on: boolean): Promise<void> {
  await tab(page, '校閲')
  const button = page.locator('button[title="変更履歴の記録を開始または終了する"]')
  const active = (await button.getAttribute('aria-pressed')) === 'true'
  if (active !== on) await button.click()
}

async function setAuthor(page: Page, name: string): Promise<void> {
  await tab(page, '校閲')
  await page.locator('[data-testid="revision-author"]').fill(name)
}

/** コメントペインを開く */
async function openComments(page: Page): Promise<void> {
  await tab(page, '校閲')
  if ((await page.locator('.comments-pane').count()) === 0) {
    await page.locator('button[title="コメントの一覧を開閉する"]').click()
  }
}

/** 本文を全選択する。効くまで繰り返す (上の caretAtStart と同じ理由) */
async function selectAll(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await page.locator('.wowd-content p').first().click()
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(150)
    const selected = await page.evaluate(() => (window.getSelection()?.toString() ?? '').length)
    if (selected > 0) return
  }
  throw new Error('本文を全選択できなかった')
}

// ───────────────────────── 各文書 ─────────────────────────

/** 無編集で開いて保存しただけのペア。元ファイルも一緒に渡すのが要点 */
async function roundTripPair(
  page: Page,
  fixture: string,
  originalName: string,
  savedName: string
): Promise<void> {
  writeFileSync(join(OUT_DIR, originalName), readFileSync(join(FIXTURE_DIR, fixture)))
  console.log(`  ${originalName}  (元ファイル)`)
  await openFixture(page, fixture)
  await save(page, savedName)
}

async function readme(page: Page): Promise<void> {
  await newDoc(page)
  await typeGuide(page, [
    'Wowd 実機確認キット',
    '',
    'このフォルダの .docx を Word で順に開いて、本文に書かれた確認事項を見てください。',
    '',
    '最重要: どのファイルも、開いた直後に「問題を修復しますか」「読み取り不能なコンテンツ」が出ないこと。',
    '出たら、その時点でファイル名をお知らせください。以降の確認は不要です。',
    '',
    '「元」と「Wowd保存」のペアになっているファイルは、両方を開いてください。',
    '元が開けて Wowd保存 が開けない場合だけ Wowd の問題です。',
    '両方とも開けない場合は、確認用ファイルを作った側の問題なのでお知らせください。',
    '',
    '詳しい確認項目は docs/word-verification.md にあります。'
  ])
  await save(page, '00-はじめにお読みください.docx')
}

async function trackChanges(page: Page): Promise<void> {
  await newDoc(page)
  await typeGuide(page, [
    '確認: 変更履歴',
    '1. [校閲] タブ →「変更履歴」で、赤入りが表示されること',
    '2. 挿入が下線、削除が取り消し線で、著者ごとに色が違うこと',
    '3. 著者名が「校閲者A」「校閲者B」と出ること',
    '4. [承諾]／[元に戻す] が効くこと',
    '5. 段落記号(¶)の挿入・削除も変更として出ること',
    '',
    'ここから下が赤入りの対象です。',
    'この行は校閲者A が削除します。'
  ])

  // 記録を始める前に土台を書いておく。記録中に自分で入れた文字を消すと
  // 跡を残さず消えるのが正しい動作なので、削除の赤入りにはならない
  await setAuthor(page, '校閲者A')
  await setTracking(page, true)

  await page.locator('.wowd-content p').last().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('校閲者A が挿入した文です。')

  // 記録前からあった行を消す (削除の赤入り)
  await page.locator('.wowd-content p', { hasText: 'この行は校閲者A が削除します。' }).click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.waitForTimeout(150)
  await page.keyboard.press('Delete')
  await page.waitForTimeout(200)

  await setAuthor(page, '校閲者B')
  await page.locator('.wowd-content p').last().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('校閲者B が後から足した文です。')

  await setTracking(page, false)
  await save(page, '10-変更履歴.docx')
}

async function comments(page: Page): Promise<void> {
  await newDoc(page)
  await typeGuide(page, [
    '確認: コメント',
    '1. [校閲] タブ →「コメントの表示」で 2 件のスレッドが出ること',
    '2. 1 件目に返信がぶら下がっていること (別々のコメントに分かれていないこと)',
    '3. 2 件目が「解決済み」になっていること',
    '4. コメントが付いた範囲が本文中で強調されること'
  ])

  await openComments(page)

  // 1 件目: 返信つき
  await selectAll(page)
  await page.locator('[data-testid="comment-draft"]').fill('ここは検討が必要です。')
  await page.locator('[data-testid="comment-add"]').click()
  await page.waitForTimeout(200)

  await page.locator('.comment-thread button', { hasText: '返信' }).first().click()
  await page.locator('[data-testid="comment-draft"]').fill('同意します。修正しました。')
  await page.locator('[data-testid="comment-add"]').click()
  await page.waitForTimeout(200)

  // 2 件目: 解決済み
  await page.locator('.wowd-content p').last().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Home')
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(150)
  await page.locator('[data-testid="comment-draft"]').fill('これは解決済みのコメントです。')
  await page.locator('[data-testid="comment-add"]').click()
  await page.waitForTimeout(200)
  await page.locator('.comment-thread').last().locator('button', { hasText: '解決' }).click()
  await page.waitForTimeout(200)

  await save(page, '11-コメント.docx')
}

async function image(page: Page, app: ElectronApplication): Promise<void> {
  await newDoc(page)
  await typeGuide(page, [
    '確認: 画像',
    '1. 下に画像が表示されること (空欄や × 印になっていないこと)',
    '2. 画像を選んだとき、図として扱えること (サイズ変更ができること)',
    ''
  ])

  // ファイル選択ダイアログは自動では押せないので、main 側を差し替える
  await app.evaluate(async ({ dialog }, picked: string) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [picked]
    })) as unknown as typeof dialog.showOpenDialog
  }, SAMPLE_PNG)

  await page.locator('.wowd-content p').last().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+End')
  await tab(page, '挿入')
  await page.locator('button[title="画像ファイルを選んで本文に挿入する"]').click()
  await page.waitForTimeout(500)

  await save(page, '12-画像.docx')
}

async function headerFooter(page: Page): Promise<void> {
  await newDoc(page)
  await typeGuide(page, [
    '確認: ヘッダーとフッター',
    '1. ヘッダーに「社外秘」が右寄せで出ること',
    '2. フッターに「- 1 -」のようにページ番号が数字で出ること',
    '3. ヘッダー領域をダブルクリックして、Word 側で編集できること',
    '4. ページ番号がフィールドとして扱われること (灰色に反転すること)'
  ])

  await tab(page, '挿入')
  await page.locator('button[title="ヘッダーとフッターを編集する"]').click()
  await page.waitForTimeout(300)

  await page.locator('[data-testid="header-text"]').fill('社外秘')
  await page.locator('select[title="ヘッダーの配置"]').selectOption('right')
  await page.locator('[data-testid="header-apply"]').click()

  await page.locator('[data-testid="footer-text"]').fill('- {ページ番号} -')
  await page.locator('select[title="フッターの配置"]').selectOption('center')
  await page.locator('[data-testid="footer-apply"]').click()

  await page.locator('dialog.wowd-dialog button', { hasText: 'キャンセル' }).click()
  await page.waitForTimeout(300)

  await save(page, '13-ヘッダーフッター.docx')
}

async function toc(page: Page): Promise<void> {
  await openFixture(page, '13-headings.docx')

  await tab(page, '参考資料')
  await page.locator('button[title="見出しから目次を作る。すでにあれば作り直す"]').click()
  await page.waitForTimeout(500)

  await save(page, '14-目次.docx')
}

// ───────────────────────── 生成物の検査 ─────────────────────────

/**
 * 生成したファイルに、確認してほしいものが本当に入っているかを見る。
 *
 * 画面操作は静かに失敗しうる (ボタンが無効、選択が外れる など)。
 * 空振りしたファイルを渡すと、確認する側の時間を無駄にしたうえで
 * 「Word で何も出ない」という誤った結論だけが残る。
 */
const EXPECTED: Record<string, RegExp[]> = {
  '10-変更履歴.docx': [
    /<w:ins [^>]*w:author="校閲者A"/,
    /<w:ins [^>]*w:author="校閲者B"/,
    /<w:del [^>]*w:author="校閲者A"/,
    /<w:delText/,
    // 段落記号そのものの挿入
    /<w:pPr><w:rPr><w:ins /
  ],
  '11-コメント.docx': [/<w:commentRangeStart/, /<w:commentReference/],
  '12-画像.docx': [/<w:drawing>/, /xmlns:wp=/, /r:embed="/],
  '13-ヘッダーフッター.docx': [/<w:headerReference/, /<w:footerReference/],
  '14-目次.docx': [/\bTOC\b/, /\bPAGEREF\b/]
}

/** パートの中身に対する検査 */
const EXPECTED_PARTS: Record<string, { part: string; pattern: RegExp }[]> = {
  '11-コメント.docx': [
    { part: 'word/comments.xml', pattern: /<w:comment [^>]*w:id="2"/ },
    { part: 'word/commentsExtended.xml', pattern: /w15:paraIdParent=/ },
    { part: 'word/commentsExtended.xml', pattern: /w15:done="1"/ }
  ],
  '13-ヘッダーフッター.docx': [
    { part: 'word/header1.xml', pattern: /社外秘/ },
    { part: 'word/footer1.xml', pattern: /PAGE/ }
  ],
  '14-目次.docx': [{ part: 'word/settings.xml', pattern: /<w:updateFields/ }]
}

function inspect(): number {
  console.log('\n生成物を検査します:')
  let failures = 0

  for (const name of readdirSync(OUT_DIR).sort()) {
    if (!name.endsWith('.docx')) continue
    const bytes = new Uint8Array(readFileSync(join(OUT_DIR, name)))

    let parts: Record<string, Uint8Array>
    try {
      parts = unzipSync(bytes)
    } catch (err) {
      console.error(`  NG  ${name}: zip として読めない (${String(err)})`)
      failures++
      continue
    }

    // 全 XML パートが整形式か
    for (const [part, data] of Object.entries(parts)) {
      if (!part.endsWith('.xml') && !part.endsWith('.rels')) continue
      try {
        parseXml(strFromU8(data))
      } catch {
        console.error(`  NG  ${name}: ${part} が整形式でない`)
        failures++
      }
    }

    // Wowd 自身が読み直せるか
    try {
      const model = readDocx(bytes, name)
      let length = 0
      const walk = (node: { type?: string; text?: string; content?: unknown[] }): void => {
        if (node.type === 'text' && node.text) length += node.text.length
        for (const child of (node.content ?? []) as typeof node[]) walk(child)
      }
      model.doc.content.forEach((b) => walk(b as never))
      if (length === 0) {
        console.error(`  NG  ${name}: 読み直すと本文が空`)
        failures++
      }
    } catch (err) {
      console.error(`  NG  ${name}: 読み直せない (${String(err)})`)
      failures++
      continue
    }

    const documentXml = strFromU8(parts['word/document.xml'] as Uint8Array)
    for (const pattern of EXPECTED[name] ?? []) {
      if (!pattern.test(documentXml)) {
        console.error(`  NG  ${name}: document.xml に ${pattern} が無い`)
        failures++
      }
    }
    for (const { part, pattern } of EXPECTED_PARTS[name] ?? []) {
      const data = parts[part]
      if (!data) {
        console.error(`  NG  ${name}: ${part} が無い`)
        failures++
        continue
      }
      if (!pattern.test(strFromU8(data))) {
        console.error(`  NG  ${name}: ${part} に ${pattern} が無い`)
        failures++
      }
    }
  }

  console.log(failures === 0 ? '  すべて OK' : `  ${failures} 件の問題`)
  return failures
}

async function main(): Promise<void> {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.error('  [画面エラー]', e.message))
  await page.waitForSelector('.wowd-content', { timeout: 30_000 })

  // 復元の案内が出ているとクリックの邪魔になる
  await page.evaluate(() => window.wowd.clearRecovery())
  await page.reload()
  await page.waitForSelector('.wowd-content', { timeout: 30_000 })

  console.log('実機 Word 確認用のファイルを生成します:')
  try {
    await readme(page)
    await roundTripPair(page, '01-plain.docx', '01-往復-元.docx', '01-往復-Wowd保存.docx')
    await roundTripPair(
      page,
      '05-kitchen-sink.docx',
      '02-書式と見出し-元.docx',
      '02-書式と見出し-Wowd保存.docx'
    )
    await roundTripPair(page, '08-tables.docx', '03-表-元.docx', '03-表-Wowd保存.docx')
    await roundTripPair(page, '06-ruby.docx', '04-ルビ-元.docx', '04-ルビ-Wowd保存.docx')
    await roundTripPair(
      page,
      '07-grid-40x36.docx',
      '05-原稿用紙-元.docx',
      '05-原稿用紙-Wowd保存.docx'
    )
    await roundTripPair(page, '15-headers.docx', '06-ヘッダー-元.docx', '06-ヘッダー-Wowd保存.docx')

    await trackChanges(page)
    await comments(page)
    await image(page, app)
    await headerFooter(page)
    await toc(page)
  } finally {
    await app.close()
  }

  if (inspect() > 0) {
    console.error('\n生成物に問題があります。渡す前に直してください')
    process.exit(1)
  }

  console.log(`\n完了: ${OUT_DIR}`)
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
