import { BrowserWindow, dialog, ipcMain, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { IPC, type PrintRequest, type PrintResult } from '../../shared/ipc'

/**
 * 印刷用文書は専用のセッションで開く。
 *
 * 本文をディスクに書かずに済ませたいので一時ファイルは使わない。
 * data: URL はトップレベル遷移が禁じられているうえ、オリジンが不透明になって
 * CSP をヘッダで付けられない (文書自身に meta で書かせることになる)。
 *
 * 独自スキームなら、メインウィンドウより厳しい CSP をヘッダで付けられる。
 * スクリプトは一切許可しない。メインウィンドウの CSP は defaultSession に
 * 付けているので、別パーティションを使えば互いに干渉しない。
 */
const PRINT_PARTITION = 'wowd-print'
const PRINT_SCHEME = 'wowd-print'

/** 一度きり・時間制限つきで HTML を渡す */
const pending = new Map<string, { html: string; expires: number }>()
const TOKEN_TTL_MS = 30_000

/**
 * printToPDF の pageSize と margins は「インチ」で指定する。
 * 以前の API はマイクロメートルだったが、Chromium の CDP 実装に置き換わった際に
 * 単位が変わっている。マイクロメートルの値を渡すと無意味な用紙サイズになる。
 */
const MM_PER_INCH = 25.4

export function registerPrintIpc(): void {
  const printSession = session.fromPartition(PRINT_PARTITION, { cache: false })

  printSession.protocol.handle(PRINT_SCHEME, (request) => {
    const token = new URL(request.url).pathname.replace(/^\/+/, '')
    const entry = pending.get(token)
    pending.delete(token)
    if (!entry || entry.expires < Date.now()) {
      return new Response('', { status: 404 })
    }
    return new Response(entry.html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'"
      }
    })
  })

  ipcMain.handle(IPC.printToPdf, async (_e, request: PrintRequest): Promise<PrintResult> => {
    let targetPath = request.targetPath
    if (!targetPath) {
      const owner = BrowserWindow.getFocusedWindow()
      const options = {
        defaultPath: request.defaultName || '文書.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      }
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { path: null, pageCount: 0 }
      targetPath = result.filePath.toLowerCase().endsWith('.pdf')
        ? result.filePath
        : `${result.filePath}.pdf`
    }

    const bytes = await renderPdf(request, printSession)
    await writeFile(targetPath, bytes)
    return { path: targetPath, pageCount: request.pageCount }
  })
}

async function renderPdf(
  request: PrintRequest,
  printSession: Electron.Session
): Promise<Uint8Array> {
  const token = randomUUID()
  pending.set(token, { html: request.html, expires: Date.now() + TOKEN_TTL_MS })

  const win = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      session: printSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // 印刷用文書は HTML と CSS だけ。JS を切っても失うものは無い
      javascript: false
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  try {
    await win.loadURL(`${PRINT_SCHEME}://print/${token}`)
    // フォントの適用が終わるのを待つ。JS を切っているので document.fonts は使えない
    await new Promise((resolve) => setTimeout(resolve, 150))

    const first = request.papers[0]
    return await win.webContents.printToPDF({
      // @page の指定を優先させる。これが無いとプリンタ既定の用紙になる
      preferCSSPageSize: true,
      printBackground: true,
      // 余白は印刷用 HTML の .wowd-print-page が持っているのでここでは 0
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      scale: 1,
      // preferCSSPageSize が効かない場合の保険。単位はインチ
      ...(first
        ? {
            pageSize: {
              width: first.widthMm / MM_PER_INCH,
              height: first.heightMm / MM_PER_INCH
            }
          }
        : {}),
      // ヘッダー / フッターは文書の本物の内容なので、Chromium のものは使わない
      displayHeaderFooter: false
    })
  } finally {
    pending.delete(token)
    win.destroy()
  }
}
