import { app, BrowserWindow, protocol, session } from 'electron'
import { createWindow, hardenNavigation } from './window'
import { registerFileIpc } from './ipc/files'
import { registerRecentIpc, setRecentChangeHandler } from './ipc/recent'
import { registerPrintIpc } from './ipc/print'
import { registerRecoveryIpc, clearRecoveryOnExit } from './ipc/recovery'
import { buildMenu } from './menu'
import { IPC } from '../shared/ipc'

// 印刷用の独自スキーム。app.whenReady の前に宣言する必要がある
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wowd-print',
    privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false }
  }
])

// 二重起動を禁止し、2 つ目の起動はファイルを開く要求として既存ウィンドウに転送する
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  /** OS がアプリ起動前に渡してきたファイル (macOS の open-file) を保持する */
  let pendingOpen: string | null = null

  function requestOpen(path: string): void {
    if (mainWindow) mainWindow.webContents.send(IPC.openFileRequest, path)
    else pendingOpen = path
  }

  function docxArg(argv: string[]): string | null {
    return argv.find((a) => a.toLowerCase().endsWith('.docx')) ?? null
  }

  app.on('second-instance', (_e, argv) => {
    const f = docxArg(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    if (f) requestOpen(f)
  })

  app.on('open-file', (event, path) => {
    event.preventDefault()
    requestOpen(path)
  })

  void app.whenReady().then(async () => {
    // レンダラは自分自身とインラインスタイル、blob 画像しか読み込めない
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'"
          ]
        }
      })
    })

    hardenNavigation()
    registerFileIpc()
    registerRecentIpc()
    registerPrintIpc()
    registerRecoveryIpc()
    setRecentChangeHandler(() => void buildMenu())
    await buildMenu()

    mainWindow = createWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    const fromArgv = docxArg(process.argv.slice(1))
    const initial = pendingOpen ?? fromArgv
    if (initial) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send(IPC.openFileRequest, initial)
      })
      pendingOpen = null
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  // 正常終了。退避を消しておくと、次の起動で「前回は落ちた」と分かる
  app.on('before-quit', () => {
    void clearRecoveryOnExit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
