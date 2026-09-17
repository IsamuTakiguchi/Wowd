import { dialog, ipcMain, shell, app, BrowserWindow } from 'electron'
import { readFile, writeFile, rename, mkdtemp, open, unlink } from 'node:fs/promises'
import { basename, join, isAbsolute, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { IPC, type OpenedFile, type TemplateId } from '../../shared/ipc'

const DOCX_FILTER = [{ name: 'Word 文書', extensions: ['docx'] }]

/** レンダラから来たパスは信用しない。絶対パスで .docx であることを main 側で再検証する */
function assertSafeDocxPath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0) throw new Error('パスが不正です')
  const abs = resolve(p)
  if (!isAbsolute(abs)) throw new Error('パスが不正です')
  if (abs.split(sep).includes('..')) throw new Error('パスが不正です')
  if (!abs.toLowerCase().endsWith('.docx')) throw new Error('.docx 以外は扱えません')
  return abs
}

/**
 * 一時ファイルへ書いて fsync してから rename する。
 * 保存中にクラッシュしても原本が失われないようにするため、上書きは rename 一回に閉じる。
 */
async function writeFileAtomic(target: string, bytes: Uint8Array): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'wowd-'))
  const tmp = join(tmpDir, basename(target) + '.tmp')
  try {
    await writeFile(tmp, bytes)
    const fh = await open(tmp, 'r+')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    await rename(tmp, target)
  } catch (err) {
    // rename 前に失敗した場合のみ一時ファイルが残る
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}

export function registerFileIpc(): void {
  ipcMain.handle(IPC.openDialog, async (): Promise<OpenedFile | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: DOCX_FILTER })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: DOCX_FILTER })
    const picked = res.filePaths[0]
    if (res.canceled || !picked) return null
    return { path: picked, bytes: await readFile(picked) }
  })

  ipcMain.handle(IPC.openPath, async (_e, p: string): Promise<OpenedFile> => {
    const abs = assertSafeDocxPath(p)
    return { path: abs, bytes: await readFile(abs) }
  })

  ipcMain.handle(IPC.saveDialog, async (_e, defaultPath?: string): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      defaultPath: defaultPath ?? '無題.docx',
      filters: DOCX_FILTER,
      properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    return res.filePath.toLowerCase().endsWith('.docx') ? res.filePath : res.filePath + '.docx'
  })

  ipcMain.handle(IPC.writeFile, async (_e, p: string, bytes: Uint8Array): Promise<void> => {
    const abs = assertSafeDocxPath(p)
    await writeFileAtomic(abs, bytes)
  })

  ipcMain.handle(IPC.readTemplate, async (_e, id: TemplateId): Promise<Uint8Array> => {
    if (id !== 'blank-a4' && id !== 'blank-ja-b5') throw new Error('未知のテンプレートです')
    const base = app.isPackaged
      ? join(process.resourcesPath, 'templates')
      : join(app.getAppPath(), 'resources', 'templates')
    return await readFile(join(base, `${id}.docx`))
  })

  ipcMain.handle(IPC.showItemInFolder, async (_e, p: string): Promise<void> => {
    shell.showItemInFolder(assertSafeDocxPath(p))
  })

  ipcMain.handle(IPC.getAppInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    locale: app.getLocale()
  }))

  ipcMain.handle(IPC.confirmDiscard, async (_e, name: string): Promise<boolean> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      type: 'warning' as const,
      buttons: ['保存しない', 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      message: `${name} には保存されていない変更があります。`,
      detail: '変更を破棄してよろしいですか?'
    }
    const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    return res.response === 0
  })

  ipcMain.handle(IPC.reportError, async (_e, title: string, message: string): Promise<void> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { type: 'error' as const, message: title, detail: message, buttons: ['OK'] }
    if (win) await dialog.showMessageBox(win, opts)
    else await dialog.showMessageBox(opts)
  })
}
