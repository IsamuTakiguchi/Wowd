import { create } from 'zustand'
import {
  useDocumentStore,
  pickDocumentData,
  captureLatestDocument,
  captureEditor,
  EMPTY_DOCUMENT_DATA,
  type DocumentData
} from './document'
import { platform } from '../platform'
import type { TemplateId } from '@shared/ipc'

/**
 * 文書のタブ。Excel のシート見出しと同じ操作感にする。
 *
 * **1 枚のタブ = 1 つの .docx。** Excel のシートは 1 つのファイルの中の部品だが、
 * .docx には「1 ファイルに複数の本文」という形が無い。無理に詰めると Word で開けなくなり、
 * Wowd の存在理由 (Word と行き来できること) が崩れる。
 * そこで、見た目と操作は Excel のシート見出しに寄せ、中身は別々のファイルにした。
 *
 * ## 作り
 *
 * 画面に出ている文書 (アクティブなタブ) は、これまでどおり useDocumentStore が持つ。
 * リボンも印刷もコメント欄も、すべてそこだけを見ればよい。
 * 裏に回ったタブは、このストアの parked に**丸ごと預けておく**。
 * 切り替えは「今の文書を預ける → 行き先を戻す」の 2 手で済む。
 *
 * 預けるときはエディタの状態 (元に戻す履歴・選択位置) も一緒に預ける。
 * 内容だけ預けて作り直すと、タブを行き来しただけで「元に戻す」が効かなくなる。
 */

/** タブの色。Excel の「シート見出しの色」と同じく、見分けやすくするためだけのもの */
export const TAB_COLORS = [
  { id: 'red', label: '赤', value: '#d13438' },
  { id: 'orange', label: '橙', value: '#ca5010' },
  { id: 'yellow', label: '黄', value: '#c19c00' },
  { id: 'green', label: '緑', value: '#107c10' },
  { id: 'blue', label: '青', value: '#2b579a' },
  { id: 'purple', label: '紫', value: '#8764b8' },
  { id: 'gray', label: '灰', value: '#69797e' }
] as const

export interface TabInfo {
  /** 英数字だけの短い id。退避の枠の名前にも使う */
  id: string
  /** 見出しの色。null は既定 */
  color: string | null
}

/** 裏に回ったタブの中身 */
interface Parked {
  data: DocumentData
  /** エディタの状態。一度も表に出ていないタブは null */
  editorState: unknown | null
  scrollTop: number
}

/** 見出しに出す要約。アクティブなタブも裏のタブも同じ形で見られるようにする */
export interface TabSummary extends TabInfo {
  title: string
  dirty: boolean
  /** ファイルの場所。未保存なら null */
  filePath: string | null
  active: boolean
}

interface TabsState {
  tabs: TabInfo[]
  activeId: string
  /** 裏に回ったタブ。変更のたびに作り直して、購読している画面を動かす */
  parked: ReadonlyMap<string, Parked>
  /** 「文書1」「文書2」… の次の番号 */
  untitledCounter: number

  /** 新しいタブで白紙の文書を作る */
  newTab: (template?: TemplateId) => Promise<void>
  /**
   * ファイルを開く。
   *  - すでに開いているファイルなら、そのタブへ移るだけ (二重に開かない。Excel と同じ)
   *  - いまのタブが手つかずの白紙なら、そこに開く (白紙のタブを残さない)
   *  - それ以外は新しいタブに開く
   */
  openFile: (file: { path: string | null; bytes: Uint8Array }) => Promise<void>
  /** ファイルを選ぶ画面を出して開く */
  openDialog: () => Promise<void>
  /** 最近使ったファイルなど、場所の分かっているファイルを開く */
  openPath: (path: string) => Promise<void>
  switchTo: (id: string) => void
  /** 次 / 前のタブへ。端まで行ったら反対側へ回る (Excel の Ctrl+PageDown と同じ) */
  cycle: (step: 1 | -1) => void
  /** タブを閉じる。未保存なら確かめる。閉じたら true */
  closeTab: (id: string) => Promise<boolean>
  /** ほかのタブをすべて閉じる。途中で取り消されたらそこで止める */
  closeOthers: (id: string) => Promise<void>
  /** 並べ替え。from の位置にあるタブを to の位置へ */
  moveTab: (from: number, to: number) => void
  setColor: (id: string, color: string | null) => void
  /**
   * 名前を変える。未保存の文書だけ。
   * 保存済みの文書の名前はファイル名そのものなので、ここで変えると食い違う。
   * そちらは「名前を付けて保存」で変える
   */
  rename: (id: string, name: string) => boolean
  /** どれか 1 つでも未保存のタブがあるか。終了の確認に使う */
  anyDirty: () => boolean
  /** 裏のタブの中身を差し替える。自動保存が裏で保存し終えたときに使う */
  updateParked: (id: string, patch: Partial<DocumentData>) => void
  /** 裏のタブの中身を覗く。自動保存と退避が使う */
  parkedData: (id: string) => DocumentData | null
}

let idCounter = 1
function nextId(): string {
  return `t${idCounter++}`
}

const FIRST_ID = nextId()

export const useTabsStore = create<TabsState>((set, get) => {
  /** いまのタブを裏へ回す */
  function park(): void {
    const { activeId, parked } = get()
    const ds = useDocumentStore.getState()
    const editor = captureEditor()
    const data: DocumentData = {
      ...pickDocumentData(ds),
      // エディタが消える前に最新の本文を拾う。拾わないと切り替えた瞬間に編集が消える
      document: captureLatestDocument(ds)
    }
    const next = new Map(parked)
    next.set(activeId, {
      data,
      editorState: editor?.state ?? null,
      scrollTop: editor?.scrollTop ?? 0
    })
    set({ parked: next })
  }

  /** 裏のタブを表に出す。いまのタブは預けない (呼ぶ側で預けるか捨てるかを決める) */
  function bringBack(id: string): void {
    const { parked } = get()
    const entry = parked.get(id)
    if (!entry) return
    const next = new Map(parked)
    next.delete(id)
    const ds = useDocumentStore.getState()
    useDocumentStore.setState({
      ...entry.data,
      pendingEditorState: entry.editorState,
      pendingScrollTop: entry.scrollTop,
      error: null,
      busy: false,
      // エディタはこの値の変化を見て中身を差し替える
      loadToken: ds.loadToken + 1
    })
    set({ parked: next, activeId: id })
  }

  function untitledName(): string {
    const n = get().untitledCounter
    set({ untitledCounter: n + 1 })
    return `文書${n}`
  }

  /** 新しいタブを作って表に出す。中身は呼ぶ側が読み込む */
  function openBlankTab(): string {
    park()
    const id = nextId()
    set((s) => ({ tabs: [...s.tabs, { id, color: null }], activeId: id }))
    useDocumentStore.setState({
      ...EMPTY_DOCUMENT_DATA,
      untitledName: untitledName(),
      pendingEditorState: null,
      pendingScrollTop: null
    })
    return id
  }

  function findByPath(path: string): string | null {
    const { activeId, parked } = get()
    if (useDocumentStore.getState().filePath === path) return activeId
    for (const [id, entry] of parked) if (entry.data.filePath === path) return id
    return null
  }

  return {
    tabs: [{ id: FIRST_ID, color: null }],
    activeId: FIRST_ID,
    parked: new Map(),
    // 起動時の白紙が「文書1」になる。App が最初の文書を作るときに使う
    untitledCounter: 1,

    async newTab(template = 'blank-a4') {
      openBlankTab()
      await useDocumentStore.getState().newDocument(template)
    },

    async openFile(file) {
      // すでに開いていれば、そのタブへ移るだけ
      if (file.path) {
        const existing = findByPath(file.path)
        if (existing) {
          get().switchTo(existing)
          return
        }
      }
      const ds = useDocumentStore.getState()
      const pristine = !ds.filePath && !ds.dirty
      if (!pristine) openBlankTab()
      await useDocumentStore.getState().openBytes(file.bytes, file.path)
    },

    async openDialog() {
      const file = await platform.openDialog()
      if (!file) return
      await get().openFile(file)
    },

    async openPath(path) {
      const existing = findByPath(path)
      if (existing) {
        get().switchTo(existing)
        return
      }
      try {
        const file = await platform.openPath(path)
        await get().openFile(file)
      } catch (err) {
        useDocumentStore
          .getState()
          .setError(`開けませんでした: ${err instanceof Error ? err.message : String(err)}`)
      }
    },

    switchTo(id) {
      const { activeId, parked } = get()
      if (id === activeId || !parked.has(id)) return
      park()
      bringBack(id)
    },

    cycle(step) {
      const { tabs, activeId } = get()
      if (tabs.length < 2) return
      const index = tabs.findIndex((t) => t.id === activeId)
      const next = tabs[(index + step + tabs.length) % tabs.length]
      if (next) get().switchTo(next.id)
    },

    async closeTab(id) {
      const summary = tabSummaries(get()).find((t) => t.id === id)
      if (!summary) return false
      if (summary.dirty && !(await platform.confirmDiscard(summary.title))) return false

      const { tabs, activeId } = get()
      const index = tabs.findIndex((t) => t.id === id)

      // 最後の 1 枚は消さずに白紙へ戻す。Excel もシートを 0 枚にはできない
      if (tabs.length === 1) {
        useDocumentStore.setState({ ...EMPTY_DOCUMENT_DATA, untitledName: untitledName() })
        await useDocumentStore.getState().newDocument('blank-a4')
        return true
      }

      const remaining = tabs.filter((t) => t.id !== id)
      if (id === activeId) {
        // 右隣、無ければ左隣を表に出す。閉じるタブは預けずに捨てる
        const neighbour = remaining[Math.min(index, remaining.length - 1)]
        set({ tabs: remaining })
        if (neighbour) bringBack(neighbour.id)
      } else {
        const next = new Map(get().parked)
        next.delete(id)
        set({ tabs: remaining, parked: next })
      }
      return true
    },

    async closeOthers(id) {
      for (const tab of [...get().tabs]) {
        if (tab.id === id) continue
        if (!(await get().closeTab(tab.id))) return
      }
    },

    moveTab(from, to) {
      const tabs = [...get().tabs]
      if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length || from === to) return
      const [moved] = tabs.splice(from, 1)
      if (!moved) return
      tabs.splice(to, 0, moved)
      set({ tabs })
    },

    setColor(id, color) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, color } : t)) }))
    },

    rename(id, name) {
      const trimmed = name.trim().replace(/\.docx$/i, '')
      // ファイル名に使えない文字は受け付けない。保存するときに既定の名前になるため
      if (!trimmed || /[\\/:*?"<>|]/.test(trimmed)) return false
      if (id === get().activeId) {
        if (useDocumentStore.getState().filePath) return false
        useDocumentStore.setState({ untitledName: trimmed })
        return true
      }
      const entry = get().parked.get(id)
      if (!entry || entry.data.filePath) return false
      get().updateParked(id, { untitledName: trimmed })
      return true
    },

    anyDirty() {
      if (useDocumentStore.getState().dirty) return true
      for (const entry of get().parked.values()) if (entry.data.dirty) return true
      return false
    },

    updateParked(id, patch) {
      const entry = get().parked.get(id)
      if (!entry) return
      const next = new Map(get().parked)
      next.set(id, { ...entry, data: { ...entry.data, ...patch } })
      set({ parked: next })
    },

    parkedData(id) {
      return get().parked.get(id)?.data ?? null
    }
  }
})

/** 見出しに出す要約を作る。アクティブなタブは画面の文書から、裏のタブは預かり物から */
export function tabSummaries(state: TabsState): TabSummary[] {
  const ds = useDocumentStore.getState()
  return state.tabs.map((tab) => {
    if (tab.id === state.activeId) {
      return {
        ...tab,
        title: ds.fileName(),
        dirty: ds.dirty,
        filePath: ds.filePath,
        active: true
      }
    }
    const data = state.parked.get(tab.id)?.data ?? EMPTY_DOCUMENT_DATA
    return {
      ...tab,
      title: titleOf(data),
      dirty: data.dirty,
      filePath: data.filePath,
      active: false
    }
  })
}

function titleOf(data: DocumentData): string {
  if (data.filePath) return data.filePath.split(/[\\/]/).pop() ?? data.filePath
  return data.untitledName ?? '無題'
}

/** 起動時の白紙に「文書1」と名前を付ける。App が最初の文書を作る直前に呼ぶ */
export function nameFirstDocument(): void {
  const store = useTabsStore.getState()
  if (useDocumentStore.getState().untitledName) return
  useDocumentStore.setState({ untitledName: `文書${store.untitledCounter}` })
  useTabsStore.setState({ untitledCounter: store.untitledCounter + 1 })
}
