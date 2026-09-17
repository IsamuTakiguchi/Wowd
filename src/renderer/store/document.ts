import { create } from 'zustand'
import type { WowdDocument, WowdDoc, SectionProps, CommentRecord } from '@core/model/types'
import { docxClient } from '../workers/client'
import { t } from '../i18n/ja'

export interface DocumentState {
  /** 開いている文書。null は未読み込み */
  document: WowdDocument | null
  /** 最後に読み書きしたバイト列。保存時に元パッケージを再構築するために要る */
  sourceBytes: Uint8Array | null
  filePath: string | null
  dirty: boolean
  /** リストやスタイルを編集したら numbering.xml も書き直す必要がある */
  numberingChanged: boolean
  /** コメントを編集したら comments.xml も書き直す必要がある */
  commentsChanged: boolean
  /** ヘッダー / フッターを編集したらそのパートも書き直す必要がある */
  headersChanged: boolean
  /** 目次を作ったら settings.xml に w:updateFields を立てる必要がある */
  tocChanged: boolean
  busy: boolean
  error: string | null
  /** 読み込み時に見つかった未対応要素。空でなければ画面に出す */
  unsupported: string[]
  /**
   * 表示に失敗した理由。設定されている間は保存を禁じる。
   *
   * 表示に失敗するとエディタには前の文書が残るので、そのまま保存すると
   * 開いたファイルが別物で上書きされる。黙って壊すより保存を止める。
   */
  saveBlockedReason: string | null
  /**
   * 文書を読み込むたびに増える。エディタはこの値の変化だけを見て内容を差し替える。
   * document の参照変化を見ると、編集のたびに setContent が走って履歴が消える。
   */
  loadToken: number

  fileName: () => string
  markDirty: () => void
  markNumberingChanged: () => void
  /** 目次を作った印。Word 側でページ番号を計算し直させるために要る */
  markTocChanged: () => void
  setError: (message: string | null) => void
  dismissUnsupported: () => void
  blockSaving: (reason: string) => void
  /**
   * セクション設定を差し替える。
   *
   * その場で書き換えるのではなく作り直すことで、resources の参照が変わり、
   * 画面が自然に再描画される。書き換えだと参照が同じままなので、
   * 別の印で再描画を促す必要が出てしまう。
   */
  updateSection: (index: number, patch: (section: SectionProps) => SectionProps) => void
  /** コメントを差し替える。書き直しが必要な印も立てる */
  updateComments: (
    patch: (comments: Map<string, CommentRecord>) => Map<string, CommentRecord>
  ) => void
  /**
   * ヘッダー / フッターを差し替える。
   *
   * 資源を作り直して参照を変えることで画面が再描画される。
   * その場で書き換えると参照が同じままで、用紙の飾りが更新されない。
   */
  updateHeaderFooter: (kind: 'header' | 'footer', relId: string, doc: WowdDoc) => void

  newDocument: (template: 'blank-a4' | 'blank-ja-b5') => Promise<void>
  openBytes: (bytes: Uint8Array, filePath: string | null) => Promise<void>
  openPath: (path: string) => Promise<void>
  openDialog: () => Promise<void>
  save: () => Promise<boolean>
  saveAs: () => Promise<boolean>
  /**
   * いまの内容を .docx のバイト列にする (ディスクには書かない)。
   * 保存経路を丸ごと確かめたいときに使う。
   */
  saveToBytes: () => Promise<number[]>
  /**
   * エディタの現在のツリーを取り出す関数を登録する。
   * 打鍵のたびに全文を変換するのは O(文書長) で重すぎるので、保存時にだけ引き出す。
   */
  setDocProvider: (provider: (() => WowdDoc) | null) => void
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  document: null,
  sourceBytes: null,
  filePath: null,
  dirty: false,
  numberingChanged: false,
  commentsChanged: false,
  headersChanged: false,
  tocChanged: false,
  busy: false,
  error: null,
  unsupported: [],
  saveBlockedReason: null,
  loadToken: 0,

  fileName: () => {
    const path = get().filePath
    if (!path) return t.app.untitled
    return path.split(/[\\/]/).pop() ?? t.app.untitled
  },

  markDirty: () => set({ dirty: true }),
  markNumberingChanged: () => set({ numberingChanged: true, dirty: true }),
  markTocChanged: () => set({ tocChanged: true, dirty: true }),
  setError: (message) => set({ error: message }),
  blockSaving: (reason) => set({ saveBlockedReason: reason, error: reason }),

  updateComments: (patch) => {
    const current = get().document
    if (!current) return
    const comments = patch(current.resources.comments)
    set({
      document: { ...current, resources: { ...current.resources, comments } },
      dirty: true,
      commentsChanged: true
    })
  },

  updateHeaderFooter: (kind, relId, next) => {
    const current = get().document
    if (!current) return
    const source = kind === 'header' ? current.resources.headers : current.resources.footers
    const replaced = new Map(source).set(relId, next)
    set({
      document: {
        ...current,
        resources: {
          ...current.resources,
          headers: kind === 'header' ? replaced : current.resources.headers,
          footers: kind === 'footer' ? replaced : current.resources.footers
        }
      },
      dirty: true,
      headersChanged: true
    })
  },

  updateSection: (index, patch) => {
    const current = get().document
    const target = current?.resources.sections[index]
    if (!current || !target) return
    const sections = current.resources.sections.map((s, i) => (i === index ? patch(s) : s))
    set({
      document: { ...current, resources: { ...current.resources, sections } },
      dirty: true
    })
  },
  dismissUnsupported: () => set({ unsupported: [] }),

  setDocProvider: (provider) => {
    docProvider = provider
  },

  async newDocument(template) {
    set({ busy: true, error: null })
    try {
      const bytes = await window.wowd.readTemplate(template)
      const document = await docxClient.open(bytes, null)
      set({
        document,
        sourceBytes: bytes,
        filePath: null,
        dirty: false,
        numberingChanged: false,
        commentsChanged: false,
        headersChanged: false,
        tocChanged: false,
        unsupported: document.unsupported,
        saveBlockedReason: null,
        loadToken: get().loadToken + 1
      })
    } catch (err) {
      set({ error: `${t.file.openError}: ${message(err)}` })
    } finally {
      set({ busy: false })
    }
  },

  async openBytes(bytes, filePath) {
    set({ busy: true, error: null })
    try {
      const document = await docxClient.open(bytes, filePath)
      set({
        document,
        sourceBytes: bytes,
        filePath,
        dirty: false,
        numberingChanged: false,
        commentsChanged: false,
        headersChanged: false,
        tocChanged: false,
        unsupported: document.unsupported,
        saveBlockedReason: null,
        loadToken: get().loadToken + 1
      })
      if (filePath) await window.wowd.addRecent(filePath)
    } catch (err) {
      set({ error: `${t.file.openError}: ${message(err)}` })
    } finally {
      set({ busy: false })
    }
  },

  async openPath(path) {
    if (!(await confirmDiscardIfDirty(get))) return
    try {
      const file = await window.wowd.openPath(path)
      await get().openBytes(file.bytes, file.path)
    } catch (err) {
      set({ error: `${t.file.openError}: ${message(err)}` })
    }
  },

  async openDialog() {
    if (!(await confirmDiscardIfDirty(get))) return
    const file = await window.wowd.openDialog()
    if (!file) return
    await get().openBytes(file.bytes, file.path)
  },

  async save() {
    const { filePath } = get()
    if (!filePath) return get().saveAs()
    return writeTo(filePath, get, set)
  },

  async saveToBytes() {
    const { document, sourceBytes, saveBlockedReason } = get()
    const { numberingChanged, commentsChanged, headersChanged, tocChanged } = get()
    if (!document || !sourceBytes) return []
    // 表示に失敗している状態で保存するとエディタの中身 (前の文書) を
    // 書き出してしまう。writeTo と同じく止める
    if (saveBlockedReason) return []
    const latest = docProvider?.() ?? document.doc
    const bytes = await docxClient.save({ ...document, doc: latest }, sourceBytes, {
      numberingChanged,
      commentsChanged,
      headersChanged,
      tocChanged
    })
    return Array.from(bytes)
  },

  async saveAs() {
    const suggested = get().filePath ?? `${t.app.untitled}.docx`
    const target = await window.wowd.saveDialog(suggested)
    if (!target) return false
    return writeTo(target, get, set)
  }
}))

type Get = () => DocumentState
type Set = (partial: Partial<DocumentState>) => void

/** エディタの現在ツリーを取り出す関数。Editor がマウント時に登録する */
let docProvider: (() => WowdDoc) | null = null

async function writeTo(path: string, get: Get, set: Set): Promise<boolean> {
  const { document, sourceBytes, saveBlockedReason } = get()
  const { numberingChanged, commentsChanged, headersChanged, tocChanged } = get()
  if (!document || !sourceBytes) return false
  if (saveBlockedReason) {
    set({ error: `保存を中止しました。${saveBlockedReason}` })
    return false
  }
  set({ busy: true, error: null })
  try {
    // 保存の直前にだけエディタから最新のツリーを引き出す
    const latest = docProvider?.() ?? document.doc
    const toSave: WowdDocument = { ...document, doc: latest }
    const bytes = await docxClient.save(toSave, sourceBytes, {
      numberingChanged,
      commentsChanged,
      headersChanged,
      tocChanged
    })
    await window.wowd.writeFile(path, bytes)
    await window.wowd.addRecent(path)
    // 保存後は出力を新しい原本とする。次の保存もここから差分を作る
    set({
      document: toSave,
      filePath: path,
      dirty: false,
      numberingChanged: false,
      commentsChanged: false,
      headersChanged: false,
      tocChanged: false,
      sourceBytes: bytes
    })
    return true
  } catch (err) {
    set({ error: `${t.file.saveError}: ${message(err)}` })
    return false
  } finally {
    set({ busy: false })
  }
}

async function confirmDiscardIfDirty(get: Get): Promise<boolean> {
  const state = get()
  if (!state.dirty) return true
  return window.wowd.confirmDiscard(state.fileName())
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
