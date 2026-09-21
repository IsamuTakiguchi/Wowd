import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useDocumentStore } from '../../store/document'
import { useUiStore, type RevisionDisplay } from '../../store/ui'
import { threadComments } from '@core/docx/read/comments'
import { exportPdf } from '../../print/exportPdf'
import { t } from '../../i18n/ja'

/**
 * スマホ用の画面。
 *
 * リボンは 6 つのタブと数十のボタンを横に並べる作りで、
 * 412px の画面では文字が縦に潰れて読めない (実測した)。
 * スマホでの用途は「受け取った文書を読む・コメントを見る・赤入れを確かめる・
 * 短く直す」なので、それだけを上下のバーに置く。
 *
 * 上のバー: 開く / 保存 / その他 (新規・印刷・表示・検索・変更履歴の記録)
 * 下のバー: コメント / 変更の見え方 / 前の変更 / 次の変更
 *
 * ボタンの testid は PC 版のファイル操作 (FileActions) と揃えてある。
 * 同時に出ることは無く、テストが画面の幅を気にせずに済む。
 */

/** 型の緩いエディタコマンドを名前で呼ぶ */
function run(editor: Editor | null, name: string, arg?: unknown): void {
  if (!editor) return
  const commands = editor.commands as unknown as Record<string, (a?: unknown) => boolean>
  commands[name]?.(arg)
}

export function MobileTopBar({ editor }: { editor: Editor | null }): React.JSX.Element {
  const fileName = useDocumentStore((s) => s.fileName())
  const dirty = useDocumentStore((s) => s.dirty)
  const hasDocument = useDocumentStore((s) => s.document != null)
  const viewMode = useUiStore((s) => s.viewMode)
  const setViewMode = useUiStore((s) => s.setViewMode)
  const toggleFind = useUiStore((s) => s.toggleFind)
  const tracking = useUiStore((s) => s.tracking)
  const setTracking = useUiStore((s) => s.setTracking)
  const [menuOpen, setMenuOpen] = useState(false)

  const store = useDocumentStore.getState
  const closeThen = (fn: () => void) => (): void => {
    setMenuOpen(false)
    fn()
  }
  const printPdf = (): void => {
    const state = store()
    if (!editor || !state.document) return
    void exportPdf(editor, state.document, state.fileName()).catch((err: unknown) => {
      state.setError(`PDF を出力できませんでした: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  return (
    <header className="mobile-topbar" role="toolbar" aria-label="ファイル">
      <span className="mobile-title" title={fileName}>
        <strong>Wowd</strong> {fileName}
        {dirty ? t.app.dirtyMark : ''}
      </span>
      <button type="button" data-testid="file-open" title="この端末のファイルを開く" onClick={() => void store().openDialog()}>
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
        data-testid="mobile-menu"
        title="その他の操作"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        ⋮
      </button>

      {menuOpen && (
        <>
          <div className="mobile-scrim" onClick={() => setMenuOpen(false)} />
          <div className="mobile-menu" role="menu">
            <button type="button" role="menuitem" data-testid="file-new" onClick={closeThen(() => void store().newDocument('blank-a4'))}>
              新規文書
            </button>
            <button type="button" role="menuitem" data-testid="file-pdf" disabled={!hasDocument} onClick={closeThen(printPdf)}>
              印刷 / PDF
            </button>
            <button type="button" role="menuitem" data-testid="mobile-find" onClick={closeThen(() => toggleFind(true))}>
              検索と置換
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="mobile-view"
              onClick={closeThen(() => setViewMode(viewMode === 'print' ? 'draft' : 'print'))}
            >
              {viewMode === 'print' ? '下書き表示にする (読みやすい)' : '印刷レイアウトにする (紙のとおり)'}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="mobile-tracking"
              aria-pressed={tracking}
              onClick={closeThen(() => setTracking())}
            >
              {tracking ? '変更履歴の記録を止める' : '変更履歴を記録する'}
            </button>
            <button type="button" role="menuitem" data-testid="mobile-accept-all" onClick={closeThen(() => run(editor, 'applyAllRevisions', 'accept'))}>
              すべての変更を反映
            </button>
            <button type="button" role="menuitem" data-testid="mobile-reject-all" onClick={closeThen(() => run(editor, 'applyAllRevisions', 'reject'))}>
              すべての変更を元に戻す
            </button>
          </div>
        </>
      )}
    </header>
  )
}

export function MobileBottomBar({ editor }: { editor: Editor | null }): React.JSX.Element {
  const document_ = useDocumentStore((s) => s.document)
  const commentsOpen = useUiStore((s) => s.commentsOpen)
  const toggleComments = useUiStore((s) => s.toggleComments)
  const revisionDisplay = useUiStore((s) => s.revisionDisplay)
  const setRevisionDisplay = useUiStore((s) => s.setRevisionDisplay)
  const threads = document_ ? threadComments(document_.resources.comments).length : 0

  return (
    <nav className="mobile-bottombar" role="toolbar" aria-label="校閲">
      <button
        type="button"
        data-testid="mobile-comments"
        className={`grow${commentsOpen ? ' is-active' : ''}`}
        aria-pressed={commentsOpen}
        title="コメントの一覧を開閉する"
        onClick={() => toggleComments()}
      >
        コメント{threads > 0 ? ` ${String(threads)}` : ''}
      </button>
      <select
        data-testid="mobile-display"
        title="変更履歴の表示方法"
        value={revisionDisplay}
        onChange={(e) => setRevisionDisplay(e.target.value as RevisionDisplay)}
      >
        <option value="all">変更を表示</option>
        <option value="final">変更後</option>
        <option value="original">変更前</option>
      </select>
      <button type="button" data-testid="mobile-prev" title="前の変更箇所へ移動する" onClick={() => run(editor, 'gotoRevision', -1)}>
        ◀
      </button>
      <button type="button" data-testid="mobile-next" title="次の変更箇所へ移動する" onClick={() => run(editor, 'gotoRevision', 1)}>
        ▶
      </button>
    </nav>
  )
}
