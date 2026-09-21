import type {
  WowdApi,
  OpenedFile,
  PickedImage,
  RecentEntry,
  RecoveryEntry,
  AppInfo,
  TemplateId,
  PrintRequest,
  PrintResult,
  MenuCommand
} from '@shared/ipc'
import { idbGet, idbGetAll, idbPut, idbDelete, idbClear } from './idb'

/**
 * ブラウザ (スマホを含む) 向けの実装。
 *
 * Electron 版では main プロセスがファイルやダイアログを担うが、
 * ブラウザにはそれが無い。同じ WowdApi の形で、ブラウザにあるものだけで賄う。
 *
 * ## パスが無い
 *
 * ブラウザはファイルの置き場所を教えてくれない。
 * そこで「パス」の代わりに**ファイル名**を通す。
 * 開いたファイルと保存したファイルは IndexedDB にも控えておくので、
 * 「最近使ったファイル」から名前だけで開き直せる。
 *
 * ## 保存は 3 通り
 *
 *   1. showSaveFilePicker がある (PC の Chrome / Edge) … 本当の「名前を付けて保存」
 *   2. 共有できる (スマホ)                            … 共有シートから「ファイルに保存」やメール
 *   3. どちらも無い                                   … ダウンロード
 *
 * 2 と 3 は、Electron 版の「保存ダイアログ → 書き込み」の 2 段階を
 * 1 段階で済ませる。saveDialog は名前を返すだけで、writeFile が実際に出す。
 */

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_RECENT = 12
const MAX_RECOVERY = 8

interface RecentRecord {
  name: string
  openedAt: number
  bytes: Uint8Array
}

interface RecoveryRecord {
  id: string
  originalPath: string | null
  name: string
  savedAt: number
  bytes: Uint8Array
}

/** showSaveFilePicker で得た書き込み先。同じ名前への保存で使い回す */
const handles = new Map<string, FileSystemFileHandle>()

declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName?: string
      types?: { description: string; accept: Record<string, string[]> }[]
    }) => Promise<FileSystemFileHandle>
    launchQueue?: {
      setConsumer: (cb: (params: { files: FileSystemFileHandle[] }) => void) => void
    }
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function isTouchDevice(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

/**
 * ファイル選択を出して 1 つ受け取る。取り消されたら null。
 *
 * <input type=file> は取り消しを教えてくれないブラウザがある。
 * 焦点が戻ってから少し待っても change が来なければ取り消しとみなす。
 */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const done = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => done(null))
    window.addEventListener(
      'focus',
      () => {
        // スマホでは焦点が戻ってから change が届くまでに間があるので、長めに待つ
        setTimeout(() => done(input.files?.[0] ?? null), 1500)
      },
      { once: true }
    )
    input.click()
  })
}

async function bytesOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

/** 開いた / 保存したファイルを控える。名前だけで開き直せるようにするため */
async function rememberRecent(name: string, bytes: Uint8Array): Promise<void> {
  try {
    await idbPut<RecentRecord>('recent', { name, openedAt: Date.now(), bytes })
    await pruneRecent()
  } catch {
    // 私用ブラウズなどで IndexedDB が使えない。控えが無いだけで、開閉はできる
  }
}

async function pruneRecent(): Promise<void> {
  const all = await idbGetAll<RecentRecord>('recent')
  const overflow = all.sort((a, b) => b.openedAt - a.openedAt).slice(MAX_RECENT)
  for (const entry of overflow) await idbDelete('recent', entry.name)
}

/** ダウンロードとして渡す。どこにも保存できない環境の最後の手段 */
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 10_000)
}

/** スマホでは共有シートから「ファイルに保存」やメール添付ができる */
async function shareOrDownload(name: string, blob: Blob): Promise<void> {
  const file = new File([blob], name, { type: DOCX_TYPE })
  const canShare =
    isTouchDevice() &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  if (canShare) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (err) {
      // 利用者が共有を閉じた場合は AbortError。それは保存の取り消しではなく、
      // 「別の方法で渡してほしい」と読んでダウンロードに回す
      if (!(err instanceof Error && err.name === 'AbortError')) throw err
    }
  }
  download(name, blob)
}

/** 復元の控えの id。Electron 版と同じく元の名前から決めるので、同じ文書で増えない */
function recoveryIdFor(originalPath: string | null): string {
  if (!originalPath) return 'untitled'
  let hash = 0x811c9dc5
  for (let i = 0; i < originalPath.length; i++) {
    hash ^= originalPath.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `doc-${hash.toString(16).padStart(8, '0')}`
}

export const webPlatform: WowdApi = {
  async openDialog(): Promise<OpenedFile | null> {
    const file = await pickFile('.docx,' + DOCX_TYPE)
    if (!file) return null
    const bytes = await bytesOf(file)
    await rememberRecent(file.name, bytes)
    return { path: file.name, bytes }
  },

  async openPath(path: string): Promise<OpenedFile> {
    // ブラウザにパスは無い。「最近使ったファイル」の控えから名前で引く
    const found = await idbGet<RecentRecord>('recent', basename(path))
    if (!found) throw new Error('この端末に控えが残っていません。もう一度ファイルを選んでください')
    return { path: found.name, bytes: found.bytes }
  },

  async saveDialog(defaultPath?: string): Promise<string | null> {
    const suggested = basename(defaultPath ?? '無題.docx')
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: 'Word 文書', accept: { [DOCX_TYPE]: ['.docx'] } }]
        })
        handles.set(handle.name, handle)
        return handle.name
      } catch {
        // 取り消し
        return null
      }
    }
    // 保存先を選ぶ手段が無い環境では、名前だけ決めて writeFile に任せる
    return suggested
  },

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const name = basename(path)
    const blob = new Blob([bytes as BlobPart], { type: DOCX_TYPE })
    const handle = handles.get(name)
    if (handle) {
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    } else {
      await shareOrDownload(name, blob)
    }
    await rememberRecent(name, bytes)
  },

  async readTemplate(id: TemplateId): Promise<Uint8Array> {
    const url = new URL(`templates/${id}.docx`, document.baseURI)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`テンプレートを読めませんでした (${String(res.status)})`)
    return new Uint8Array(await res.arrayBuffer())
  },

  async pickImage(): Promise<PickedImage | null> {
    const file = await pickFile('image/png,image/jpeg,image/gif,image/bmp,image/svg+xml')
    if (!file) return null
    const bytes = await bytesOf(file)
    let width: number | null = null
    let height: number | null = null
    try {
      const bitmap = await createImageBitmap(file)
      width = bitmap.width
      height = bitmap.height
      bitmap.close()
    } catch {
      // SVG などは寸法が取れないことがある。挿入側が既定の大きさにする
    }
    return { name: file.name, contentType: file.type || 'application/octet-stream', bytes, width, height }
  },

  async getRecent(): Promise<RecentEntry[]> {
    try {
      const all = await idbGetAll<RecentRecord>('recent')
      return all
        .sort((a, b) => b.openedAt - a.openedAt)
        .map((e) => ({ path: e.name, name: e.name, openedAt: e.openedAt }))
    } catch {
      return []
    }
  },

  async addRecent(path: string): Promise<void> {
    // 中身は openDialog / writeFile が控えているので、ここでは時刻を更新するだけ
    try {
      const found = await idbGet<RecentRecord>('recent', basename(path))
      if (found) await idbPut<RecentRecord>('recent', { ...found, openedAt: Date.now() })
    } catch {
      // 控えられなくても開閉はできる
    }
  },

  async clearRecent(): Promise<void> {
    try {
      await idbClear('recent')
    } catch {
      // 何も無い
    }
  },

  async saveRecovery(bytes: Uint8Array, originalPath: string | null, name: string): Promise<void> {
    await idbPut<RecoveryRecord>('recovery', {
      id: recoveryIdFor(originalPath),
      originalPath,
      name,
      savedAt: Date.now(),
      bytes
    })
    const all = await idbGetAll<RecoveryRecord>('recovery')
    for (const stale of all.sort((a, b) => b.savedAt - a.savedAt).slice(MAX_RECOVERY)) {
      await idbDelete('recovery', stale.id)
    }
  },

  async listRecovery(): Promise<RecoveryEntry[]> {
    try {
      const all = await idbGetAll<RecoveryRecord>('recovery')
      return all
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(({ id, originalPath, name, savedAt }) => ({ id, originalPath, name, savedAt }))
    } catch {
      return []
    }
  },

  async readRecovery(id: string): Promise<Uint8Array | null> {
    const found = await idbGet<RecoveryRecord>('recovery', id)
    return found?.bytes ?? null
  },

  async clearRecovery(): Promise<void> {
    await idbClear('recovery')
  },

  async getAppInfo(): Promise<AppInfo> {
    return {
      version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
      platform: 'web',
      locale: navigator.language
    }
  },

  async showItemInFolder(): Promise<void> {
    // ブラウザにはフォルダの概念が無い
  },

  async confirmDiscard(name: string): Promise<boolean> {
    return window.confirm(`「${name}」には保存していない変更があります。\n破棄してよろしいですか？`)
  },

  async reportError(title: string, message: string): Promise<void> {
    window.alert(`${title}\n\n${message}`)
  },

  /**
   * 印刷。ブラウザの印刷ダイアログから「PDF として保存」できる。
   * スマホでも印刷シートから PDF にできる (iPhone は共有 → プリント → ピンチで PDF)。
   *
   * 見えない iframe に印刷用 HTML を流し込んで print() を呼ぶ。
   * 用紙の大きさは @page で指定する。CSS はページごとに用紙を変えられないので、
   * 最初のセクションの用紙で全体を出す。
   */
  async printToPdf(request: PrintRequest): Promise<PrintResult> {
    const paper = request.papers[0] ?? { widthMm: 210, heightMm: 297 }
    const pageCss = `<style>@page{size:${paper.widthMm}mm ${paper.heightMm}mm;margin:0}</style>`
    const html = request.html.includes('</head>')
      ? request.html.replace('</head>', `${pageCss}</head>`)
      : pageCss + request.html

    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(iframe)
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve()
      iframe.srcdoc = html
    })
    const win = iframe.contentWindow
    if (win) {
      win.focus()
      win.print()
    }
    // 印刷ダイアログが閉じるまで iframe が要る。閉じたことは分からないので、長めに残す
    setTimeout(() => iframe.remove(), 60_000)
    return { path: null, pageCount: request.pageCount }
  },

  /**
   * ネイティブメニューが無いので、同じショートカットをキー入力から作る。
   * 元に戻す / やり直しはエディタ自身が持つので触らない。
   * Ctrl+N と Ctrl+W はブラウザに取られて横取りできない。
   */
  onMenuCommand(cb: (cmd: MenuCommand) => void): () => void {
    const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    const listener = (e: KeyboardEvent): void => {
      const mod = isApple ? e.metaKey : e.ctrlKey
      if (!mod || e.altKey) return
      let cmd: MenuCommand | null = null
      switch (e.key.toLowerCase()) {
        case 's':
          cmd = e.shiftKey ? { kind: 'file.saveAs' } : { kind: 'file.save' }
          break
        case 'o':
          cmd = { kind: 'file.open' }
          break
        case 'p':
          cmd = { kind: 'file.printPdf' }
          break
        case 'f':
          cmd = { kind: 'edit.find' }
          break
        case '+':
        case '=':
        case ';':
          cmd = { kind: 'view.zoom', delta: 10 }
          break
        case '-':
          cmd = { kind: 'view.zoom', delta: -10 }
          break
        case '0':
          cmd = { kind: 'view.zoom', delta: 0 }
          break
      }
      if (!cmd) return
      e.preventDefault()
      cb(cmd)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  },

  /**
   * OS から「このファイルを Wowd で開く」と渡されたとき (File Handling API)。
   * 名前で開き直せるよう、先に控えてから知らせる。
   */
  onOpenFileRequest(cb: (path: string) => void): () => void {
    const queue = window.launchQueue
    if (queue) {
      queue.setConsumer((params) => {
        void (async () => {
          for (const handle of params.files) {
            const file = await handle.getFile()
            await rememberRecent(file.name, await bytesOf(file))
            cb(file.name)
          }
        })()
      })
    }
    return () => undefined
  },

  /** タブを閉じる前に、未保存なら確認を出す */
  onQueryDirty(cb: () => boolean): () => void {
    const listener = (e: BeforeUnloadEvent): void => {
      if (!cb()) return
      e.preventDefault()
      // 古いブラウザ向け。文言は無視されるが、空でないことが要る
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }
}
