import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../store/document'

/**
 * クイック アクセス ツールバー。Excel・Word と同じく、自動保存の右に
 * 上書き保存・元に戻す・やり直しを置く。リボンのタブを切り替えても常に見える。
 */
export function QuickAccess({ editor }: { editor: Editor | null }): React.JSX.Element {
  const dirty = useDocumentStore((s) => s.dirty)
  const hasDocument = useDocumentStore((s) => s.document != null)

  // 元に戻せるかは取引のたびに変わる
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!editor) return
    const bump = (): void => setTick((n) => n + 1)
    editor.on('transaction', bump)
    return () => {
      editor.off('transaction', bump)
    }
  }, [editor])

  const canUndo = editor?.can().undo() ?? false
  const canRedo = editor?.can().redo() ?? false

  return (
    <div className="quick-access" role="toolbar" aria-label="クイック アクセス">
      <button
        type="button"
        title="上書き保存 (Ctrl+S)"
        aria-label="上書き保存"
        data-testid="qat-save"
        disabled={!hasDocument}
        className={dirty ? 'is-dirty' : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void useDocumentStore.getState().save()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 2.5h9l2 2v9h-11z" fill="none" stroke="currentColor" />
          <path d="M5 2.5v3.5h5V2.5M4.5 13.5V9h7v4.5" fill="none" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        title="元に戻す (Ctrl+Z)"
        aria-label="元に戻す"
        data-testid="qat-undo"
        disabled={!canUndo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.5 4 2.5 7l3 3" fill="none" stroke="currentColor" />
          <path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H7" fill="none" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        title="やり直し (Ctrl+Y)"
        aria-label="やり直し"
        data-testid="qat-redo"
        disabled={!canRedo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10.5 4l3 3-3 3" fill="none" stroke="currentColor" />
          <path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H9" fill="none" stroke="currentColor" />
        </svg>
      </button>
    </div>
  )
}
