import { create } from 'zustand'

export type RibbonTab = 'home' | 'insert' | 'layout' | 'references' | 'review' | 'view'

/**
 * 表示モード。
 *  print: 印刷レイアウト。ページに分割して用紙として描く
 *  draft: 下書き。ページ分割せず連続スクロール
 *
 * 下書き表示は逃げ道として常に残す。病的な文書でページ分割が
 * うまくいかなくても、編集そのものが止まらないようにするため。
 */
export type ViewMode = 'print' | 'draft'

/** 開いているモーダルダイアログ */
export type DialogKind = 'ruby' | 'pageSetup' | 'headerFooter' | null

/**
 * 変更履歴の表示モード。
 *  all      すべての変更を表示
 *  final    変更をすべて反映した姿 (削除を隠す)
 *  original 変更前の姿 (挿入を隠す)
 *
 * 表示だけの切り替えで、文書の中身は変わらない。
 */
export type RevisionDisplay = 'all' | 'final' | 'original'

export interface UiState {
  tab: RibbonTab
  zoom: number
  findOpen: boolean
  viewMode: ViewMode
  /** 原稿用紙のマス目を表示する */
  showGrid: boolean
  /** 現在カーソルがあるページ (1 始まり) */
  currentPage: number
  /** 文書全体のページ数 */
  pageCount: number
  /**
   * 紙からはみ出した表の数。
   *
   * Wowd は表をページ間で分割しないので、1 ページに収まらない表は
   * 紙からはみ出す。黙って溢れさせると「Wowd が表を壊した」に見えるので、
   * 出ていることを画面で伝える。
   */
  overflowingTables: number
  dialog: DialogKind
  /** コメントペインを開いているか */
  commentsOpen: boolean
  /** 変更履歴を記録中か */
  tracking: boolean
  /** 変更履歴に残す著者名 */
  author: string
  /** 変更履歴の表示モード */
  revisionDisplay: RevisionDisplay

  setTab: (tab: RibbonTab) => void
  setZoom: (zoom: number) => void
  nudgeZoom: (delta: number) => void
  toggleFind: (open?: boolean) => void
  setViewMode: (mode: ViewMode) => void
  toggleGrid: (on?: boolean) => void
  setPageInfo: (current: number, count: number) => void
  setOverflowingTables: (n: number) => void
  openDialog: (kind: DialogKind) => void
  toggleComments: (open?: boolean) => void
  setTracking: (on?: boolean) => void
  setAuthor: (author: string) => void
  setRevisionDisplay: (display: RevisionDisplay) => void
}

export const MIN_ZOOM = 50
export const MAX_ZOOM = 300

/** 既定の著者名。Word の「ユーザー名」に当たる */
const DEFAULT_AUTHOR = '利用者'
const AUTHOR_KEY = 'wowd.author'

function loadAuthor(): string {
  // 保存できない環境 (プライベートウィンドウなど) でも動くようにする
  try {
    return localStorage.getItem(AUTHOR_KEY) || DEFAULT_AUTHOR
  } catch {
    return DEFAULT_AUTHOR
  }
}

function saveAuthor(author: string): void {
  try {
    localStorage.setItem(AUTHOR_KEY, author)
  } catch {
    // 保存できなくても編集は続けられる
  }
}

export const useUiStore = create<UiState>((set) => ({
  tab: 'home',
  zoom: 100,
  findOpen: false,
  viewMode: 'print',
  showGrid: false,
  currentPage: 1,
  pageCount: 1,
  overflowingTables: 0,
  dialog: null,
  commentsOpen: false,
  tracking: false,
  author: loadAuthor(),
  revisionDisplay: 'all',

  setTab: (tab) => set({ tab }),
  setZoom: (zoom) => set({ zoom: clamp(zoom) }),
  // delta 0 は「100% に戻す」の意味で使う
  nudgeZoom: (delta) => set((s) => ({ zoom: delta === 0 ? 100 : clamp(s.zoom + delta) })),
  toggleFind: (open) => set((s) => ({ findOpen: open ?? !s.findOpen })),
  setViewMode: (viewMode) => set({ viewMode }),
  toggleGrid: (on) => set((s) => ({ showGrid: on ?? !s.showGrid })),
  openDialog: (dialog) => set({ dialog }),
  toggleComments: (open) => set((s) => ({ commentsOpen: open ?? !s.commentsOpen })),
  setTracking: (on) => set((s) => ({ tracking: on ?? !s.tracking })),
  setAuthor: (author) => {
    saveAuthor(author)
    set({ author })
  },
  setRevisionDisplay: (revisionDisplay) => set({ revisionDisplay }),
  setOverflowingTables: (n) =>
    set((s) => (s.overflowingTables === n ? s : { overflowingTables: n })),
  setPageInfo: (currentPage, pageCount) =>
    set((s) =>
      s.currentPage === currentPage && s.pageCount === pageCount ? s : { currentPage, pageCount }
    )
}))

function clamp(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)))
}
