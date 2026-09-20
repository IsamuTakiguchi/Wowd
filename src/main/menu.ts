import { Menu, app, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC, type MenuCommand } from '../shared/ipc'
import { getRecent } from './ipc/recent'
import { checkForUpdates } from './update'

function send(cmd: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(IPC.menuCommand, cmd)
}

export async function buildMenu(): Promise<void> {
  const recent = await getRecent()
  const isMac = process.platform === 'darwin'

  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? recent.map((e) => ({
        label: e.name,
        toolTip: e.path,
        click: () => send({ kind: 'file.openRecent', path: e.path })
      }))
    : [{ label: '(なし)', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { label: 'Wowd について', click: () => send({ kind: 'help.about' }) },
              { type: 'separator' },
              { role: 'hide', label: 'Wowd を隠す' },
              { role: 'hideOthers', label: 'ほかを隠す' },
              { role: 'unhide', label: 'すべてを表示' },
              { type: 'separator' },
              { role: 'quit', label: 'Wowd を終了' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'ファイル(&F)',
      submenu: [
        {
          label: '新規作成 (A4)',
          accelerator: 'CmdOrCtrl+N',
          click: () => send({ kind: 'file.new', template: 'blank-a4' })
        },
        {
          label: '新規作成 (B5 日本語)',
          click: () => send({ kind: 'file.new', template: 'blank-ja-b5' })
        },
        {
          label: '開く...',
          accelerator: 'CmdOrCtrl+O',
          click: () => send({ kind: 'file.open' })
        },
        { label: '最近使用したファイル', submenu: recentItems },
        { type: 'separator' },
        {
          label: '上書き保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => send({ kind: 'file.save' })
        },
        {
          label: '名前を付けて保存...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send({ kind: 'file.saveAs' })
        },
        { type: 'separator' },
        {
          label: 'PDF として保存...',
          accelerator: 'CmdOrCtrl+P',
          click: () => send({ kind: 'file.printPdf' })
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '閉じる' } : { role: 'quit', label: '終了' }
      ]
    },
    {
      label: '編集(&E)',
      submenu: [
        { label: '元に戻す', accelerator: 'CmdOrCtrl+Z', click: () => send({ kind: 'edit.undo' }) },
        {
          label: 'やり直し',
          accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y',
          click: () => send({ kind: 'edit.redo' })
        },
        { type: 'separator' },
        { role: 'cut', label: '切り取り' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: '貼り付け' },
        {
          // 役割 (role) ではなく本文のコマンドに回す。
          // role の selectAll はブラウザ既定の全選択で、
          // 選択状態が ProseMirror へ非同期にしか伝わらない
          label: 'すべて選択',
          accelerator: 'CmdOrCtrl+A',
          click: () => send({ kind: 'edit.selectAll' })
        },
        { type: 'separator' },
        { label: '検索と置換...', accelerator: 'CmdOrCtrl+F', click: () => send({ kind: 'edit.find' }) }
      ]
    },
    {
      label: '表示(&V)',
      submenu: [
        { label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: () => send({ kind: 'view.zoom', delta: 10 }) },
        { label: '縮小', accelerator: 'CmdOrCtrl+-', click: () => send({ kind: 'view.zoom', delta: -10 }) },
        { label: '100%', accelerator: 'CmdOrCtrl+0', click: () => send({ kind: 'view.zoom', delta: 0 }) },
        { type: 'separator' },
        { role: 'reload', label: '再読み込み' },
        { role: 'toggleDevTools', label: '開発者ツール' }
      ]
    },
    {
      label: '校閲(&R)',
      submenu: [
        {
          label: '変更履歴の記録',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send({ kind: 'review.toggleTracking' })
        },
        { type: 'separator' },
        {
          label: 'すべての変更を反映',
          click: () => send({ kind: 'review.applyAll', action: 'accept' })
        },
        {
          label: 'すべての変更を元に戻す',
          click: () => send({ kind: 'review.applyAll', action: 'reject' })
        },
        { type: 'separator' },
        {
          label: '次の変更',
          accelerator: 'Alt+CmdOrCtrl+N',
          click: () => send({ kind: 'review.goto', direction: 1 })
        },
        {
          label: '前の変更',
          accelerator: 'Alt+CmdOrCtrl+P',
          click: () => send({ kind: 'review.goto', direction: -1 })
        },
        { type: 'separator' },
        {
          label: 'コメントの表示',
          accelerator: 'Alt+CmdOrCtrl+M',
          click: () => send({ kind: 'review.toggleComments' })
        }
      ]
    },
    {
      label: 'ヘルプ(&H)',
      submenu: [
        // 自動では確認しない。選んだときだけ外部へ問い合わせる
        { label: '更新を確認...', click: () => void checkForUpdates() },
        { type: 'separator' },
        { label: 'Wowd について', click: () => send({ kind: 'help.about' }) }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
