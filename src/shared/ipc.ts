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
  getAppInfo: 'wowd:app:info',
  showItemInFolder: 'wowd:shell:showItem',
  confirmDiscard: 'wowd:dialog:confirmDiscard',
  reportError: 'wowd:dialog:error',
  // main → renderer (push)
  menuCommand: 'wowd:menu:command',
  openFileRequest: 'wowd:file:openRequest',
  queryDirty: 'wowd:app:queryDirty'
} as const

export interface OpenedFile {
  path: string
  bytes: Uint8Array
}

export interface RecentEntry {
  path: string
  name: string
  openedAt: number
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
  | { kind: 'edit.undo' }
  | { kind: 'edit.redo' }
  | { kind: 'edit.find' }
  | { kind: 'view.zoom'; delta: number }
  | { kind: 'help.about' }

export interface WowdApi {
  openDialog(): Promise<OpenedFile | null>
  openPath(path: string): Promise<OpenedFile>
  saveDialog(defaultPath?: string): Promise<string | null>
  /** アトミック書き込み (tmp へ書いて fsync → rename)。保存中のクラッシュで原本を失わない */
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  readTemplate(id: TemplateId): Promise<Uint8Array>

  getRecent(): Promise<RecentEntry[]>
  addRecent(path: string): Promise<void>
  clearRecent(): Promise<void>

  getAppInfo(): Promise<AppInfo>
  showItemInFolder(path: string): Promise<void>
  /** 未保存の変更を破棄してよいか確認する。true = 破棄してよい */
  confirmDiscard(name: string): Promise<boolean>
  reportError(title: string, message: string): Promise<void>

  onMenuCommand(cb: (cmd: MenuCommand) => void): () => void
  onOpenFileRequest(cb: (path: string) => void): () => void
  /** main からの「未保存か?」問い合わせに答えるハンドラを登録する */
  onQueryDirty(cb: () => boolean): () => void
}
