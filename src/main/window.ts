import { BrowserWindow, shell, app } from 'electron'
import { join } from 'node:path'

/**
 * .docx は外部から来るバイナリで攻撃面でもあるため、レンダラの権限は最小に固定する。
 * この設定は緩めない。
 */
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: '#f3f3f3',
    title: 'Wowd',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 外部リンクは必ず既定ブラウザへ逃がす。アプリ内でナビゲートさせない。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

/** アプリ全体のナビゲーション封じ込め。createWindow の前に一度だけ呼ぶ */
export function hardenNavigation(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env['ELECTRON_RENDERER_URL']
      if (devUrl && url.startsWith(devUrl)) return
      event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}
