import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../store/document'
import { useUiStore } from '../store/ui'
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

export function StatusBar({ editor }: { editor: Editor | null }): React.JSX.Element {
  const busy = useDocumentStore((s) => s.busy)
  const zoom = useUiStore((s) => s.zoom)
  const setZoom = useUiStore((s) => s.setZoom)
  const zoomMode = useUiStore((s) => s.zoomMode)
  const effectiveZoom = useUiStore((s) => s.effectiveZoom)
  const fitZoom = useUiStore((s) => s.fitZoom)
  const viewMode = useUiStore((s) => s.viewMode)
  const pageCount = useUiStore((s) => s.pageCount)

  const text = editor?.getText() ?? ''
  const counts = countCharacters(text)
  const paragraphs = editor?.state.doc.childCount ?? 0

  return (
    <footer className="statusbar">
      <span>{busy ? '処理中...' : t.status.ready}</span>
      {viewMode === 'print' && (
        <span data-testid="page-count">
          {pageCount.toLocaleString('ja-JP')} ページ
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
        <input
          type="range"
          min={50}
          max={300}
          step={10}
          value={zoomMode === 'auto' ? effectiveZoom : zoom}
          aria-label="表示倍率"
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        {/* 指定した値ではなく、実際に掛かっている倍率を出す */}
        <span data-testid="zoom-readout">{effectiveZoom}%</span>
      </div>
    </footer>
  )
}
