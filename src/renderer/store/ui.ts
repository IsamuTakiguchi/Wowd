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

/**
 * 倍率の決め方。
 *
 *  auto   … 紙が窓に収まらないときだけ縮める。収まるなら 100%
 *  manual … 利用者が指定した倍率をそのまま使う
 *
 * 既定は auto。窓を狭めただけで紙の右半分が見えなくなるのを防ぐ。
 * 倍率をいじった時点で manual に移り、以後は黙って変えない。
 */
export type ZoomMode = 'auto' | 'manual'

export interface UiState {
  tab: RibbonTab
  zoom: number
  zoomMode: ZoomMode
  /**
   * 実際に画面へ掛かっている倍率 (%)。
   *
   * auto のときは窓の幅で決まるので、利用者が指定した zoom とは違う。
   * ステータスバーにはこちらを出す。違う数字を出すと、
   * 「100% と書いてあるのに紙が小さい」ことになる。
   */
  effectiveZoom: number
  findOpen: boolean
  viewMode: ViewMode
  /** 原稿用紙のマス目を表示する */
  showGrid: boolean
  /** ルーラ (目盛り) を表示する */
  showRuler: boolean
  /**
   * 裁ちトンボを表示する。
   *
   * 画面と PDF の両方に効く。Wowd は「画面の見た目と PDF が一致する」ことを
   * 構造で保証しているので、ここだけ別扱いにしない。
   */
  showTrimMarks: boolean
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
  /** 「幅に合わせる」。自動で決め直させる */
  fitZoom: () => void
  setEffectiveZoom: (percent: number) => void
  toggleFind: (open?: boolean) => void
  setViewMode: (mode: ViewMode) => void
  toggleGrid: (on?: boolean) => void
  toggleRuler: (on?: boolean) => void
  toggleTrimMarks: (on?: boolean) => void
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
const RULER_KEY = 'wowd.showRuler'
const TRIM_KEY = 'wowd.showTrimMarks'

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

/**
 * 作業環境の設定を覚えておく。
 *
 * ルーラの出し入れは「文書の中身」ではなく「その人の作業環境」なので、
 * 起動のたびに戻ると煩わしい。倍率や表示モードを覚えないのは、
 * そちらは文書ごとに変えるものだから。
 */
function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

function saveFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // 保存できなくても編集は続けられる
  }
}

export const useUiStore = create<UiState>((set) => ({
  tab: 'home',
  zoom: 100,
  zoomMode: 'auto',
  effectiveZoom: 100,
  findOpen: false,
  viewMode: 'print',
  showGrid: false,
  // ルーラは既定で出す。Word もそうで、字下げの位置が見えないと直しにくい
  showRuler: loadFlag(RULER_KEY, true),
  // トンボは入稿のときだけ要るので既定では出さない
  showTrimMarks: loadFlag(TRIM_KEY, false),
  currentPage: 1,
  pageCount: 1,
  overflowingTables: 0,
  dialog: null,
  commentsOpen: false,
  tracking: false,
  author: loadAuthor(),
  revisionDisplay: 'all',

  setTab: (tab) => set({ tab }),
  // 倍率に触れたら、以後は自動で変えない
  setZoom: (zoom) => set({ zoom: clamp(zoom), zoomMode: 'manual' }),
  // delta 0 は「100% に戻す」の意味で使う
  nudgeZoom: (delta) =>
    set((s) => ({ zoom: delta === 0 ? 100 : clamp(s.zoom + delta), zoomMode: 'manual' })),
  fitZoom: () => set({ zoomMode: 'auto' }),
  setEffectiveZoom: (percent) =>
    set((s) => (s.effectiveZoom === percent ? s : { effectiveZoom: percent })),
  toggleFind: (open) => set((s) => ({ findOpen: open ?? !s.findOpen })),
  setViewMode: (viewMode) => set({ viewMode }),
  toggleGrid: (on) => set((s) => ({ showGrid: on ?? !s.showGrid })),
  toggleRuler: (on) =>
    set((s) => {
      const showRuler = on ?? !s.showRuler
      saveFlag(RULER_KEY, showRuler)
      return { showRuler }
    }),
  toggleTrimMarks: (on) =>
    set((s) => {
      const showTrimMarks = on ?? !s.showTrimMarks
      saveFlag(TRIM_KEY, showTrimMarks)
      return { showTrimMarks }
    }),
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
