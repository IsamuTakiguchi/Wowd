import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useUiStore } from '../store/ui'
import { useDocumentStore } from '../store/document'
import { collectHeadings, jumpTo, type HeadingEntry } from './navigate'

/**
 * ナビゲーション ウィンドウ (Word の「見出し」)。
 *
 * アウトライン レベルのある段落 (見出しスタイル、岡口マクロのランクなど) を並べ、
 * 押すとそこへ移る。いまカーソルのある節を強調する。
 */
export function NavigationPane({ editor }: { editor: Editor | null }): React.JSX.Element | null {
  const open = useUiStore((s) => s.navigationOpen)
  const toggle = useUiStore((s) => s.toggleNavigation)
  const styles = useDocumentStore((s) => s.document?.resources.styles)
  const [headings, setHeadings] = useState<HeadingEntry[]>([])
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    if (!editor || !open) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      setHeadings(collectHeadings(editor))
      setCursor(editor.state.selection.from)
    }
    // 打鍵のたびに文書全体を数え直すと重いので、手が止まってから
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }): void => {
      if (!transaction.docChanged) {
        setCursor(editor.state.selection.from)
        return
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 300)
    }
    refresh()
    editor.on('transaction', onTransaction)
    return () => {
      if (timer) clearTimeout(timer)
      editor.off('transaction', onTransaction)
    }
  }, [editor, open, styles])

  if (!open) return null
  const current = headings.filter((h) => h.pos < cursor).at(-1)

  return (
    <aside className="nav-pane" aria-label="ナビゲーション" data-testid="nav-pane">
      <div className="nav-pane-header">
        <span>ナビゲーション</span>
        <button type="button" aria-label="閉じる" title="閉じる" onClick={() => toggle(false)}>
          ×
        </button>
      </div>
      <div className="nav-pane-label">見出し</div>
      {headings.length === 0 ? (
        <p className="nav-pane-empty">
          見出しがありません。見出しスタイル (ホーム → スタイル) や、岡口マクロのランク (Alt+1〜8) を当てると、ここに並びます。
        </p>
      ) : (
        <ul className="nav-pane-list">
          {headings.map((h) => (
            <li key={h.pos}>
              <button
                type="button"
                className={h === current ? 'is-current' : undefined}
                style={{ paddingInlineStart: `${8 + h.level * 14}px` }}
                title={h.text}
                onClick={() => editor && jumpTo(editor, h.pos)}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
