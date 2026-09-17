import { dialog, ipcMain, shell, app, nativeImage, BrowserWindow } from 'electron'
import { readFile, writeFile, rename, mkdtemp, open, unlink } from 'node:fs/promises'
import { basename, join, isAbsolute, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { IPC, type OpenedFile, type TemplateId, type PickedImage } from '../../shared/ipc'

const DOCX_FILTER = [{ name: 'Word 文書', extensions: ['docx'] }]

/**
 * 挿入できる画像。Word が既定で扱える形式に絞る。
 * 拡張子からコンテンツタイプを決めるので、対応表がそのまま許可リストになる。
 */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

/** 挿入できる画像の上限。極端に大きいものは文書ごと開けなくなる */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024

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
    // 開発時もビルド後も out/main/index.js から見た相対位置で解決する。
    // app.getAppPath() はエントリのあるディレクトリを返すので使えない。
    const base = app.isPackaged
      ? join(process.resourcesPath, 'templates')
      : join(__dirname, '..', '..', 'resources', 'templates')
    return await readFile(join(base, `${id}.docx`))
  })

  ipcMain.handle(IPC.pickImage, async (): Promise<PickedImage | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      properties: ['openFile' as const],
      filters: [{ name: '画像', extensions: Object.keys(IMAGE_TYPES) }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const picked = res.filePaths[0]
    if (res.canceled || !picked) return null

    const ext = picked.split('.').pop()?.toLowerCase() ?? ''
    const contentType = IMAGE_TYPES[ext]
    if (!contentType) throw new Error('対応していない画像形式です')

    const bytes = await readFile(picked)
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('画像が大きすぎます (32MB まで)')

    // 実寸はここで測る。renderer 側で測ると挿入までに 1 往復増える
    const size = nativeImage.createFromBuffer(bytes).getSize()
    return {
      name: basename(picked),
      contentType,
      bytes,
      width: size.width > 0 ? size.width : null,
      height: size.height > 0 ? size.height : null
    }
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
