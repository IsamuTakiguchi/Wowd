/**
 * main ⇄ renderer の唯一の契約。
 * チャネル名とペイロード型をここに集約し、ipcRenderer は preload だけが触る。
 */

export const IPC = {
  openDialog: 'wowd:file:openDialog',
  openPath: 'wowd:file:openPath',
  saveDialog: 'wowd:file:saveDialog',
  writeFile: 'wowd:file:write',
  getRecent: 'wowd:recent:get',
  addRecent: 'wowd:recent:add',
  clearRecent: 'wowd:recent:clear',
  readTemplate: 'wowd:template:read',
  pickImage: 'wowd:image:pick',
  getAppInfo: 'wowd:app:info',
  showItemInFolder: 'wowd:shell:showItem',
  confirmDiscard: 'wowd:dialog:confirmDiscard',
  reportError: 'wowd:dialog:error',
  printToPdf: 'wowd:print:toPdf',
  saveRecovery: 'wowd:recovery:save',
  listRecovery: 'wowd:recovery:list',
  readRecovery: 'wowd:recovery:read',
  clearRecovery: 'wowd:recovery:clear',
  // main → renderer (push)
  menuCommand: 'wowd:menu:command',
  openFileRequest: 'wowd:file:openRequest',
  queryDirty: 'wowd:app:queryDirty'
} as const

export interface OpenedFile {
  path: string
  bytes: Uint8Array
}

/** 挿入のために読み込んだ画像 */
export interface PickedImage {
  /** 元のファイル名 (拡張子つき) */
  name: string
  /** 拡張子から決めたコンテンツタイプ */
  contentType: string
  bytes: Uint8Array
  /** ピクセル単位の実寸。分からなければ null */
  width: number | null
  height: number | null
}

export interface RecentEntry {
  path: string
  name: string
  openedAt: number
}

export interface PrintRequest {
  /** 完成した印刷用 HTML。外部参照を一切含まない自己完結した文書 */
  html: string
  /** 用紙。セクションごとに異なりうる */
  papers: { widthMm: number; heightMm: number }[]
  pageCount: number
  /** 保存先。null なら main 側で保存ダイアログを出す */
  targetPath: string | null
  /** ダイアログの既定ファイル名 */
  defaultName: string
}

export interface PrintResult {
  /** 実際に保存した先。取り消された場合は null */
  path: string | null
  pageCount: number
}

/**
 * 自動保存された復元候補。
 *
 * id は main 側が振る不透明な識別子で、renderer からはこれしか触れない。
 * renderer にパスを組み立てさせない (組み立てさせると
 * 任意の場所を読み書きさせる隙になる)。
 */
export interface RecoveryEntry {
  id: string
  /** 元のファイルのパス。未保存の文書なら null */
  originalPath: string | null
  /** 画面に出す名前 */
  name: string
  savedAt: number
}

export interface AppInfo {
  version: string
  platform: string
  locale: string
}

/** 既定テンプレートの識別子。resources/templates/<id>.docx に対応する */
export type TemplateId = 'blank-a4' | 'blank-ja-b5'

/**
 * ネイティブメニューやショートカットから renderer に送られるコマンド。
 * renderer 側の単一の switch で処理する。
 */
export type MenuCommand =
  | { kind: 'file.new'; template: TemplateId }
  | { kind: 'file.open' }
  | { kind: 'file.openRecent'; path: string }
  | { kind: 'file.save' }
  | { kind: 'file.saveAs' }
  | { kind: 'file.printPdf' }
  | { kind: 'edit.undo' }
  | { kind: 'edit.redo' }
  | { kind: 'edit.find' }
  | { kind: 'edit.selectAll' }
  | { kind: 'view.zoom'; delta: number }
  | { kind: 'view.toggleRuler' }
  | { kind: 'view.toggleTrimMarks' }
  | { kind: 'review.toggleTracking' }
  | { kind: 'review.applyAll'; action: 'accept' | 'reject' }
  | { kind: 'review.goto'; direction: 1 | -1 }
  | { kind: 'review.toggleComments' }
  | { kind: 'help.about' }

export interface WowdApi {
  openDialog(): Promise<OpenedFile | null>
  openPath(path: string): Promise<OpenedFile>
  saveDialog(defaultPath?: string): Promise<string | null>
  /** アトミック書き込み (tmp へ書いて fsync → rename)。保存中のクラッシュで原本を失わない */
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  readTemplate(id: TemplateId): Promise<Uint8Array>
  /** 画像を選んで読み込む。取り消されたら null */
  pickImage(): Promise<PickedImage | null>

  getRecent(): Promise<RecentEntry[]>
  addRecent(path: string): Promise<void>
  clearRecent(): Promise<void>

  /** 自動保存。未保存の変更をクラッシュから守る */
  saveRecovery(bytes: Uint8Array, originalPath: string | null, name: string): Promise<void>
  listRecovery(): Promise<RecoveryEntry[]>
  readRecovery(id: string): Promise<Uint8Array | null>
  clearRecovery(): Promise<void>

  getAppInfo(): Promise<AppInfo>
  showItemInFolder(path: string): Promise<void>
  /** 未保存の変更を破棄してよいか確認する。true = 破棄してよい */
  confirmDiscard(name: string): Promise<boolean>
  reportError(title: string, message: string): Promise<void>
  printToPdf(request: PrintRequest): Promise<PrintResult>

  onMenuCommand(cb: (cmd: MenuCommand) => void): () => void
  onOpenFileRequest(cb: (path: string) => void): () => void
  /** main からの「未保存か?」問い合わせに答えるハンドラを登録する */
  onQueryDirty(cb: () => boolean): () => void
}
