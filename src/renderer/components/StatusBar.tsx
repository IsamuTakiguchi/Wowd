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

  const text = editor?.getText() ?? ''
  const counts = countCharacters(text)
  const paragraphs = editor?.state.doc.childCount ?? 0

  return (
    <footer className="statusbar">
      <span>{busy ? '処理中...' : t.status.ready}</span>
      <span className="statusbar-spacer" />
      <span>
        {t.status.chars}: {counts.withSpace.toLocaleString('ja-JP')}
      </span>
      <span>
        {t.status.charsNoSpace}: {counts.withoutSpace.toLocaleString('ja-JP')}
      </span>
      <span>
        {t.status.paragraphs}: {paragraphs.toLocaleString('ja-JP')}
      </span>
      <label className="statusbar-zoom">
        <input
          type="range"
          min={50}
          max={300}
          step={10}
          value={zoom}
          aria-label="表示倍率"
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        <span>{zoom}%</span>
      </label>
    </footer>
  )
}
