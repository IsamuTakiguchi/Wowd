import { create } from 'zustand'

export type RibbonTab = 'home' | 'insert' | 'layout' | 'references' | 'review' | 'view'

export interface UiState {
  tab: RibbonTab
  zoom: number
  findOpen: boolean
  setTab: (tab: RibbonTab) => void
  setZoom: (zoom: number) => void
  nudgeZoom: (delta: number) => void
  toggleFind: (open?: boolean) => void
}

export const MIN_ZOOM = 50
export const MAX_ZOOM = 300

export const useUiStore = create<UiState>((set) => ({
  tab: 'home',
  zoom: 100,
  findOpen: false,
  setTab: (tab) => set({ tab }),
  setZoom: (zoom) => set({ zoom: clamp(zoom) }),
  // delta 0 は「100% に戻す」の意味で使う
  nudgeZoom: (delta) =>
    set((s) => ({ zoom: delta === 0 ? 100 : clamp(s.zoom + delta) })),
  toggleFind: (open) => set((s) => ({ findOpen: open ?? !s.findOpen }))
}))

function clamp(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)))
}
