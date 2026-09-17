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
export type DialogKind = 'ruby' | 'pageSetup' | null

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
  dialog: DialogKind

  setTab: (tab: RibbonTab) => void
  setZoom: (zoom: number) => void
  nudgeZoom: (delta: number) => void
  toggleFind: (open?: boolean) => void
  setViewMode: (mode: ViewMode) => void
  toggleGrid: (on?: boolean) => void
  setPageInfo: (current: number, count: number) => void
  openDialog: (kind: DialogKind) => void
}

export const MIN_ZOOM = 50
export const MAX_ZOOM = 300

export const useUiStore = create<UiState>((set) => ({
  tab: 'home',
  zoom: 100,
  findOpen: false,
  viewMode: 'print',
  showGrid: false,
  currentPage: 1,
  pageCount: 1,
  dialog: null,

  setTab: (tab) => set({ tab }),
  setZoom: (zoom) => set({ zoom: clamp(zoom) }),
  // delta 0 は「100% に戻す」の意味で使う
  nudgeZoom: (delta) => set((s) => ({ zoom: delta === 0 ? 100 : clamp(s.zoom + delta) })),
  toggleFind: (open) => set((s) => ({ findOpen: open ?? !s.findOpen })),
  setViewMode: (viewMode) => set({ viewMode }),
  toggleGrid: (on) => set((s) => ({ showGrid: on ?? !s.showGrid })),
  openDialog: (dialog) => set({ dialog }),
  setPageInfo: (currentPage, pageCount) =>
    set((s) =>
      s.currentPage === currentPage && s.pageCount === pageCount ? s : { currentPage, pageCount }
    )
}))

function clamp(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)))
}
