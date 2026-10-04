import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../store/document'
import { useUiStore, stepZoom } from '../store/ui'
import { t } from '../i18n/ja'

/**
 * Word の「文字数」に合わせた数え方。
 * Word の文字数は空白を含む全文字数で、改行は数えない。
 */
function countCharacters(text: string): { withSpace: number; withoutSpace: number } {
  const body = text.replace(/\r?\n/g, '')
  return {
    withSpace: [...body].length,
    withoutSpace: [...body.replace(/\s/g, '')].length
  }
}

/** 倍率の選択肢 (Excel の「ズーム」画面と同じ並び) */
const ZOOM_PRESETS = [200, 150, 125, 100, 75, 50]

/**
 * 画面下のステータスバー。Excel・Word と同じ並びにする:
 *
 *   左: 状態 / ページ (いま / 全体) / 選択している文字数
 *   右: 文字数 / 表示の切り替え / − 倍率 ＋ / 倍率 (押すと倍率の選択)
 *
 * 選択している文字数は、Excel が選んだセルの合計を出すのに当たる。
 * 選んでいるときだけ出す。
 */
export function StatusBar({ editor }: { editor: Editor | null }): React.JSX.Element {
  const busy = useDocumentStore((s) => s.busy)
  const zoom = useUiStore((s) => s.zoom)
  const setZoom = useUiStore((s) => s.setZoom)
  const zoomMode = useUiStore((s) => s.zoomMode)
  const effectiveZoom = useUiStore((s) => s.effectiveZoom)
  const fitZoom = useUiStore((s) => s.fitZoom)
  const viewMode = useUiStore((s) => s.viewMode)
  const setViewMode = useUiStore((s) => s.setViewMode)
  const pageCount = useUiStore((s) => s.pageCount)
  const currentPage = useUiStore((s) => s.currentPage)
  const [zoomMenu, setZoomMenu] = useState(false)

  // 選択が変わったら数え直す。エディタの取引のたびに描き直す
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!editor) return
    const bump = (): void => setTick((n) => n + 1)
    editor.on('transaction', bump)
    return () => {
      editor.off('transaction', bump)
    }
  }, [editor])

  const text = editor?.getText() ?? ''
  const counts = countCharacters(text)
  const paragraphs = editor?.state.doc.childCount ?? 0
  const selection = editor?.state.selection
  const selected =
    editor && selection && !selection.empty
      ? countCharacters(editor.state.doc.textBetween(selection.from, selection.to, '\n')).withSpace
      : 0

  const shown = zoomMode === 'auto' ? effectiveZoom : zoom
  const nudge = (direction: 1 | -1): void => setZoom(stepZoom(shown, direction))

  return (
    <footer className="statusbar">
      <span>{busy ? '処理中...' : t.status.ready}</span>
      {viewMode === 'print' && (
        <span data-testid="page-count" title="いまのページ / 全体のページ数">
          {Math.min(currentPage, pageCount).toLocaleString('ja-JP')} / {pageCount.toLocaleString('ja-JP')} ページ
        </span>
      )}
      {selected > 0 && (
        <span data-testid="selection-count" title="選んでいる文字の数 (空白を含む。改行は数えない)">
          選択: {selected.toLocaleString('ja-JP')} 文字
        </span>
      )}
      <span className="statusbar-spacer" />
      <span>
        {t.status.chars}: {counts.withSpace.toLocaleString('ja-JP')}
      </span>
      {/* 窓が狭いときは畳む。文字数だけ残せば用は足りる */}
      <span className="statusbar-optional">
        {t.status.charsNoSpace}: {counts.withoutSpace.toLocaleString('ja-JP')}
      </span>
      <span className="statusbar-optional">
        {t.status.paragraphs}: {paragraphs.toLocaleString('ja-JP')}
      </span>

      {/* 表示の切り替え (Excel の「標準 / ページレイアウト」に当たる) */}
      <div className="statusbar-views" role="group" aria-label="表示">
        <button
          type="button"
          className={viewMode === 'print' ? 'is-active' : undefined}
          aria-pressed={viewMode === 'print'}
          title="印刷レイアウト (紙の形で表示)"
          data-testid="status-view-print"
          onClick={() => setViewMode('print')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="3" y="1.5" width="8" height="11" rx="0.5" fill="none" stroke="currentColor" />
            <path d="M5 4.5h4M5 6.5h4M5 8.5h3" stroke="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={viewMode === 'draft' ? 'is-active' : undefined}
          aria-pressed={viewMode === 'draft'}
          title="下書き (ページに分けずに続けて表示)"
          data-testid="status-view-draft"
          onClick={() => setViewMode('draft')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 3.5h10M2 6h10M2 8.5h10M2 11h7" stroke="currentColor" />
          </svg>
        </button>
      </div>

      <div className="statusbar-zoom">
        <button
          type="button"
          className={zoomMode === 'auto' ? 'is-active' : undefined}
          title="紙の幅を窓に合わせる。窓を変えると追従する"
          aria-pressed={zoomMode === 'auto'}
          data-testid="zoom-fit"
          onClick={fitZoom}
        >
          幅に合わせる
        </button>
        <button
          type="button"
          className="statusbar-step"
          title="縮小 (Ctrl+ホイールでも変えられます)"
          aria-label="縮小"
          data-testid="zoom-out"
          onClick={() => nudge(-1)}
        >
          −
        </button>
        <input
          type="range"
          min={50}
          max={300}
          step={10}
          value={shown}
          aria-label="表示倍率"
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        <button
          type="button"
          className="statusbar-step"
          title="拡大 (Ctrl+ホイールでも変えられます)"
          aria-label="拡大"
          data-testid="zoom-in"
          onClick={() => nudge(1)}
        >
          ＋
        </button>
        {/* 指定した値ではなく、実際に掛かっている倍率を出す。押すと倍率を選べる (Excel と同じ) */}
        <button
          type="button"
          className="statusbar-zoom-readout"
          title="倍率を選ぶ"
          aria-haspopup="menu"
          aria-expanded={zoomMenu}
          data-testid="zoom-readout"
          onClick={() => setZoomMenu((v) => !v)}
        >
          {effectiveZoom}%
        </button>
        {zoomMenu && (
          <ZoomMenu
            current={effectiveZoom}
            onPick={(value) => {
              setZoomMenu(false)
              if (value === 'fit') fitZoom()
              else setZoom(value)
            }}
            onClose={() => setZoomMenu(false)}
          />
        )}
      </div>
    </footer>
  )
}

function ZoomMenu({
  current,
  onPick,
  onClose
}: {
  current: number
  onPick: (value: number | 'fit') => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [custom, setCustom] = useState(String(current))
  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  return (
    <div ref={ref} className="statusbar-zoom-menu" role="menu" aria-label="倍率" data-testid="zoom-menu">
      {ZOOM_PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          role="menuitemradio"
          aria-checked={p === current}
          onClick={() => onPick(p)}
        >
          {p}%
        </button>
      ))}
      <button type="button" role="menuitem" onClick={() => onPick('fit')}>
        幅に合わせる
      </button>
      <form
        className="statusbar-zoom-custom"
        onSubmit={(e) => {
          e.preventDefault()
          const n = Number(custom.replace(/[^\d]/g, ''))
          if (n >= 10) onPick(n)
        }}
      >
        <label>
          指定
          <input
            value={custom}
            inputMode="numeric"
            aria-label="倍率 (%)"
            data-testid="zoom-custom"
            onChange={(e) => setCustom(e.target.value)}
          />
          %
        </label>
      </form>
    </div>
  )
}
