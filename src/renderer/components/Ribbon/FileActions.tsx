import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../../store/document'
import { isElectron } from '../../platform'
import { exportPdf } from '../../print/exportPdf'

/**
 * 開く・保存などのファイル操作。
 *
 * Electron 版はネイティブメニュー (ファイル → 開く…) が担うので出さない。
 * ブラウザ版にはメニューが無く、Ctrl+O を知らなければ何も開けない。
 * スマホにはキーボードすら無い。**ここが唯一の入口**になる。
 */
export function FileActions({ editor }: { editor: Editor | null }): React.JSX.Element | null {
  const dirty = useDocumentStore((s) => s.dirty)
  const hasDocument = useDocumentStore((s) => s.document != null)
  if (isElectron) return null

  const store = useDocumentStore.getState
  const printPdf = (): void => {
    const state = store()
    if (!editor || !state.document) return
    void exportPdf(editor, state.document, state.fileName()).catch((err: unknown) => {
      state.setError(`PDF を出力できませんでした: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  return (
    <div className="file-actions" role="toolbar" aria-label="ファイル">
      <button
        type="button"
        data-testid="file-open"
        title="この端末のファイルを開く"
        onClick={() => void store().openDialog()}
      >
        開く
      </button>
      <button
        type="button"
        data-testid="file-save"
        title="保存する (共有シートまたはダウンロード)"
        disabled={!hasDocument}
        className={dirty ? 'is-dirty' : undefined}
        onClick={() => void store().save()}
      >
        保存{dirty ? '*' : ''}
      </button>
      <button
        type="button"
        data-testid="file-new"
        title="新しい文書を作る"
        onClick={() => void store().newDocument('blank-a4')}
      >
        新規
      </button>
      <button
        type="button"
        data-testid="file-pdf"
        title="印刷する。印刷画面から PDF として保存できる"
        disabled={!hasDocument || !editor}
        onClick={printPdf}
      >
        印刷
      </button>
    </div>
  )
}
