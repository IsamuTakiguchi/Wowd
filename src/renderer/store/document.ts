import { create } from 'zustand'
import type { WowdDocument, WowdDoc, SectionProps, CommentRecord, StyleTable } from '@core/model/types'
import { docxClient } from '../workers/client'
import { t } from '../i18n/ja'
import { platform } from '../platform'

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
  /** スタイルを足したり置き換えたりしたら styles.xml も書き直す必要がある */
  stylesChanged: boolean
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
  /**
   * 未保存の文書の名前 (「文書1」など)。保存するときの既定の名前にもなる。
   *
   * タブを複数開くと「無題」が何枚も並び、見分けがつかない。
   * Word と同じく通し番号を振る。保存すればファイル名に置き換わる。
   */
  untitledName: string | null
  /**
   * 変更の通し番号。変更のたびに 1 増える。
   *
   * 保存は非同期なので、書き出している最中にも利用者は打ち続けられる。
   * 保存の前後でこの番号が変わっていたら、保存後も「未保存」のまま残す。
   * 残さないと、保存中に打った文字が保存済み扱いになり、次の保存まで誰も書かず、
   * 閉じるときの確認も出ずに失われる。自動保存では数秒おきに保存するので実際に起きる。
   */
  revision: number
  /**
   * 次の読み込みで、内容を作り直す代わりに戻すエディタの状態。
   *
   * タブを切り替えるたびに内容を作り直すと、元に戻す履歴も選択位置も消える。
   * 切り替えのときだけここに前の状態を置き、エディタはそれを丸ごと戻す。
   * 型を ProseMirror に縛らないのは、この層が編集部品を知らなくて済むようにするため。
   */
  pendingEditorState: unknown | null
  /** 次の読み込みで戻すスクロール位置 */
  pendingScrollTop: number | null

  fileName: () => string
  markDirty: () => void
  markNumberingChanged: () => void
  /**
   * スタイル表を差し替える。styles.xml も書き直す印を立てる。
   *
   * 表は**新しいオブジェクト**で渡すこと。画面のスタイル CSS と
   * 番号の計算は、表が別物になったことを見て作り直す。
   */
  updateStyles: (styles: StyleTable) => void
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
  /**
   * エディタの「いまの状態」を取り出す口を登録する。タブを切り替えるときに使う。
   * 戻り値は ProseMirror の EditorState だが、この層では中身を見ない。
   */
  setEditorProbe: (probe: EditorProbe | null) => void
}

export interface EditorProbe {
  state: () => unknown
  scrollTop: () => number
}

/** タブを切り替えるときに、文書ごと持ち運ぶ値 */
export type DocumentData = Pick<
  DocumentState,
  | 'document'
  | 'sourceBytes'
  | 'filePath'
  | 'dirty'
  | 'numberingChanged'
  | 'commentsChanged'
  | 'headersChanged'
  | 'tocChanged'
  | 'stylesChanged'
  | 'unsupported'
  | 'saveBlockedReason'
  | 'untitledName'
>

/** 空の文書。まだ何も読み込んでいないタブの中身 */
export const EMPTY_DOCUMENT_DATA: DocumentData = {
  document: null,
  sourceBytes: null,
  filePath: null,
  dirty: false,
  numberingChanged: false,
  commentsChanged: false,
  headersChanged: false,
  tocChanged: false,
  stylesChanged: false,
  unsupported: [],
  saveBlockedReason: null,
  untitledName: null
}

/** いまの文書から、持ち運ぶ値だけを抜き出す */
export function pickDocumentData(state: DocumentState): DocumentData {
  return {
    document: state.document,
    sourceBytes: state.sourceBytes,
    filePath: state.filePath,
    dirty: state.dirty,
    numberingChanged: state.numberingChanged,
    commentsChanged: state.commentsChanged,
    headersChanged: state.headersChanged,
    tocChanged: state.tocChanged,
    stylesChanged: state.stylesChanged,
    unsupported: state.unsupported,
    saveBlockedReason: state.saveBlockedReason,
    untitledName: state.untitledName
  }
}

/**
 * エディタが持っている最新の本文を、文書に書き戻した写しを返す。
 *
 * ストアの document.doc は保存したときにしか更新されない (打鍵のたびに
 * 全文を変換すると重すぎるため)。タブを離れるときは、エディタが消える前に
 * 最新の本文を拾っておかないと、切り替えた瞬間に編集が消える。
 */
export function captureLatestDocument(state: DocumentState): WowdDocument | null {
  if (!state.document) return null
  const latest = docProvider?.()
  return latest ? { ...state.document, doc: latest } : state.document
}

/** エディタの状態とスクロール位置。エディタが無ければ null */
export function captureEditor(): { state: unknown; scrollTop: number } | null {
  if (!editorProbe) return null
  return { state: editorProbe.state(), scrollTop: editorProbe.scrollTop() }
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
  stylesChanged: false,
  busy: false,
  error: null,
  unsupported: [],
  saveBlockedReason: null,
  loadToken: 0,
  untitledName: null,
  revision: 0,
  pendingEditorState: null,
  pendingScrollTop: null,

  fileName: () => {
    const { filePath, untitledName } = get()
    if (!filePath) return untitledName ?? t.app.untitled
    return filePath.split(/[\\/]/).pop() ?? t.app.untitled
  },

  markDirty: () => set({ dirty: true, revision: get().revision + 1 }),
  markNumberingChanged: () =>
    set({ numberingChanged: true, dirty: true, revision: get().revision + 1 }),
  updateStyles: (styles) => {
    const { document } = get()
    if (!document) return
    set({
      document: { ...document, resources: { ...document.resources, styles } },
      stylesChanged: true,
      dirty: true,
      revision: get().revision + 1
    })
  },
  markTocChanged: () => set({ tocChanged: true, dirty: true, revision: get().revision + 1 }),
  setError: (message) => set({ error: message }),
  blockSaving: (reason) => set({ saveBlockedReason: reason, error: reason }),

  updateComments: (patch) => {
    const current = get().document
    if (!current) return
    const comments = patch(current.resources.comments)
    set({
      document: { ...current, resources: { ...current.resources, comments } },
      dirty: true,
      revision: get().revision + 1,
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
      revision: get().revision + 1,
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
      dirty: true,
      revision: get().revision + 1
    })
  },
  dismissUnsupported: () => set({ unsupported: [] }),

  setDocProvider: (provider) => {
    docProvider = provider
  },

  setEditorProbe: (probe) => {
    editorProbe = probe
  },

  async newDocument(template) {
    set({ busy: true, error: null })
    try {
      const bytes = await platform.readTemplate(template)
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
        stylesChanged: false,
        unsupported: document.unsupported,
        saveBlockedReason: null,
        pendingEditorState: null,
        pendingScrollTop: null,
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
        stylesChanged: false,
        unsupported: document.unsupported,
        saveBlockedReason: null,
        // 開いたファイルには名前がある。未保存の通し番号は要らない
        untitledName: filePath ? null : get().untitledName,
        pendingEditorState: null,
        pendingScrollTop: null,
        loadToken: get().loadToken + 1
      })
      if (filePath) await platform.addRecent(filePath)
    } catch (err) {
      set({ error: `${t.file.openError}: ${message(err)}` })
    } finally {
      set({ busy: false })
    }
  },

  async openPath(path) {
    if (!(await confirmDiscardIfDirty(get))) return
    try {
      const file = await platform.openPath(path)
      await get().openBytes(file.bytes, file.path)
    } catch (err) {
      set({ error: `${t.file.openError}: ${message(err)}` })
    }
  },

  async openDialog() {
    if (!(await confirmDiscardIfDirty(get))) return
    const file = await platform.openDialog()
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
    const { numberingChanged, commentsChanged, headersChanged, tocChanged, stylesChanged } = get()
    if (!document || !sourceBytes) return []
    // 表示に失敗している状態で保存するとエディタの中身 (前の文書) を
    // 書き出してしまう。writeTo と同じく止める
    if (saveBlockedReason) return []
    const latest = docProvider?.() ?? document.doc
    const bytes = await docxClient.save({ ...document, doc: latest }, sourceBytes, {
      numberingChanged,
      commentsChanged,
      headersChanged,
      tocChanged,
      stylesChanged
    })
    return Array.from(bytes)
  },

  async saveAs() {
    const suggested = get().filePath ?? `${get().untitledName ?? t.app.untitled}.docx`
    const target = await platform.saveDialog(suggested)
    if (!target) return false
    return writeTo(target, get, set)
  }
}))

type Get = () => DocumentState
type Set = (partial: Partial<DocumentState>) => void

/** エディタの現在ツリーを取り出す関数。Editor がマウント時に登録する */
let docProvider: (() => WowdDoc) | null = null
/** エディタの状態を取り出す口。Editor がマウント時に登録する */
let editorProbe: EditorProbe | null = null

async function writeTo(path: string, get: Get, set: Set): Promise<boolean> {
  const { document, sourceBytes, saveBlockedReason } = get()
  const { numberingChanged, commentsChanged, headersChanged, tocChanged, stylesChanged } = get()
  if (!document || !sourceBytes) return false
  if (saveBlockedReason) {
    set({ error: `保存を中止しました。${saveBlockedReason}` })
    return false
  }
  set({ busy: true, error: null })
  // 書き出しを始めた時点の通し番号。終わったときに変わっていれば、途中で打たれている
  const revisionAtStart = get().revision
  try {
    // 保存の直前にだけエディタから最新のツリーを引き出す
    const latest = docProvider?.() ?? document.doc
    const toSave: WowdDocument = { ...document, doc: latest }
    const bytes = await docxClient.save(toSave, sourceBytes, {
      numberingChanged,
      commentsChanged,
      headersChanged,
      tocChanged,
      stylesChanged
    })
    await platform.writeFile(path, bytes)
    await platform.addRecent(path)

    if (get().revision !== revisionAtStart) {
      // 書き出しているあいだに変更が入った。ファイルの場所と原本だけ更新し、
      // 「未保存」と書き直しの印は残す。中身 (document) も今のものを残す。
      // 書き出し開始時の写しで上書きすると、その間に足したコメントなどが消える
      set({ filePath: path, untitledName: null, sourceBytes: bytes })
      return true
    }

    // 保存後は出力を新しい原本とする。次の保存もここから差分を作る
    set({
      document: toSave,
      filePath: path,
      untitledName: null,
      dirty: false,
      numberingChanged: false,
      commentsChanged: false,
      headersChanged: false,
      tocChanged: false,
      stylesChanged: false,
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
  return platform.confirmDiscard(state.fileName())
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
