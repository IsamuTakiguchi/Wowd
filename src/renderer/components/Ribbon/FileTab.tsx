import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { RecentEntry } from '@shared/ipc'
import { RibbonButton, RibbonGroup, RibbonRow } from './parts'
import { useDocumentStore } from '../../store/document'
import { useTabsStore } from '../../store/tabs'
import { platform } from '../../platform'
import { exportPdf } from '../../print/exportPdf'

/**
 * 「ファイル」タブ。Word の左端のタブと同じく、新規・開く・保存・印刷・閉じるをまとめる。
 * アプリ版はメニューからも同じことができるが、Word に慣れた人はまずここを探す。
 */
export function FileTab({ editor }: { editor: Editor | null }): React.JSX.Element {
  const filePath = useDocumentStore((s) => s.filePath)
  const fileName = useDocumentStore((s) => s.fileName())
  const hasDocument = useDocumentStore((s) => s.document != null)
  const [recent, setRecent] = useState<RecentEntry[]>([])

  useEffect(() => {
    let alive = true
    void platform
      .getRecent()
      .then((list) => {
        if (alive) setRecent(list.slice(0, 6))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [filePath])

  const tabs = useTabsStore.getState
  const doc = useDocumentStore.getState

  const printPdf = (): void => {
    const state = doc()
    if (!editor || !state.document) return
    void exportPdf(editor, state.document, state.fileName()).catch((err: unknown) => {
      state.setError(`PDF を出力できませんでした: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  return (
    <div className="ribbon-tab-body">
      <RibbonGroup label="新規">
        <RibbonRow>
          <RibbonButton label="白紙 (A4)" title="新しい文書 (Ctrl+N)" wide onClick={() => void tabs().newTab('blank-a4')} />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton label="B5 日本語" title="B5 の新しい文書" wide onClick={() => void tabs().newTab('blank-ja-b5')} />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="開く">
        <RibbonRow>
          <RibbonButton label="開く…" title="ファイルを開く (Ctrl+O)" wide testId="file-tab-open" onClick={() => void tabs().openDialog()} />
        </RibbonRow>
        <RibbonRow>
          <span className="ribbon-note">最近使ったファイル →</span>
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="最近使ったファイル">
        <div className="ribbon-recent" data-testid="file-tab-recent">
          {recent.length === 0 && <span className="ribbon-note">まだありません</span>}
          {recent.map((r) => (
            <button
              key={r.path}
              type="button"
              className="ribbon-recent-item"
              title={r.path}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void tabs().openPath(r.path)}
            >
              {r.name}
            </button>
          ))}
        </div>
      </RibbonGroup>

      <RibbonGroup label="保存">
        <RibbonRow>
          <RibbonButton label="上書き保存" title="上書き保存 (Ctrl+S)" wide disabled={!hasDocument} onClick={() => void doc().save()} />
        </RibbonRow>
        <RibbonRow>
          <RibbonButton
            label="名前を付けて保存"
            title="名前を付けて保存 (Ctrl+Shift+S、F12)"
            wide
            disabled={!hasDocument}
            onClick={() => void doc().saveAs()}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="印刷">
        <RibbonRow>
          <RibbonButton label="印刷 / PDF" title="印刷する。PDF として保存もできる (Ctrl+P)" wide disabled={!hasDocument} onClick={printPdf} />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="情報">
        <div className="ribbon-info">
          <div>
            <strong>{fileName}</strong>
          </div>
          <div className="ribbon-note" title={filePath ?? undefined}>
            {filePath ?? 'まだ保存していません'}
          </div>
          {filePath && (
            <button type="button" className="ribbon-link" onClick={() => void platform.showItemInFolder(filePath)}>
              保存場所を開く
            </button>
          )}
        </div>
      </RibbonGroup>

      <RibbonGroup label="閉じる">
        <RibbonRow>
          <RibbonButton
            label="閉じる"
            title="この文書を閉じる (Ctrl+W)"
            wide
            onClick={() => void tabs().closeTab(tabs().activeId)}
          />
        </RibbonRow>
      </RibbonGroup>
    </div>
  )
}
