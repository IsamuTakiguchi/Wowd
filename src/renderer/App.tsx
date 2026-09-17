import { useCallback, useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Ribbon } from './components/Ribbon'
import { StatusBar } from './components/StatusBar'
import { FindReplace } from './components/FindReplace'
import { CommentsPane } from './components/CommentsPane'
import { RubyDialog } from './components/dialogs/RubyDialog'
import { PageSetupDialog } from './components/dialogs/PageSetupDialog'
import { WowdEditor } from './editor/Editor'
import { useDocumentStore } from './store/document'
import { useUiStore } from './store/ui'
import { t } from './i18n/ja'
import type { MenuCommand } from '@shared/ipc'
import { exportPdf, registerPrintSource } from './print/exportPdf'
import { startAutosave, saveRecoveryNow } from './store/autosave'
import { RecoveryBanner } from './components/RecoveryBanner'

export function App(): React.JSX.Element {
  const [editor, setEditor] = useState<Editor | null>(null)

  const store = useDocumentStore()
  const toggleFind = useUiStore((s) => s.toggleFind)
  const dialog = useUiStore((s) => s.dialog)
  const openDialog = useUiStore((s) => s.openDialog)
  const nudgeZoom = useUiStore((s) => s.nudgeZoom)
  const setTracking = useUiStore((s) => s.setTracking)
  const toggleComments = useUiStore((s) => s.toggleComments)

  const onReady = useCallback((next: Editor | null) => setEditor(next), [])

  // 印刷はメニューからも E2E からも叩けるよう、現在の対象を登録しておく
  useEffect(() => {
    registerPrintSource(editor, store.document, store.fileName())
  }, [editor, store])

  // 起動時は空の A4 文書を開く
  useEffect(() => {
    void useDocumentStore.getState().newDocument('blank-a4')
  }, [])

  /**
   * 自動保存。未保存の変更を一定間隔で退避する。
   *
   * 退避先は userData 配下の複製で、利用者のファイルには触れない。
   * 画面を閉じるときにも一度書く。間隔の谷間で落ちた場合に備えて。
   */
  useEffect(() => {
    const stop = startAutosave()
    const onHide = (): void => {
      void saveRecoveryNow()
    }
    window.addEventListener('beforeunload', onHide)
    return () => {
      stop()
      window.removeEventListener('beforeunload', onHide)
    }
  }, [])

  // ネイティブメニューからのコマンド
  useEffect(() => {
    const handler = (cmd: MenuCommand): void => {
      const state = useDocumentStore.getState()
      switch (cmd.kind) {
        case 'file.new':
          void state.newDocument(cmd.template)
          break
        case 'file.open':
          void state.openDialog()
          break
        case 'file.openRecent':
          void state.openPath(cmd.path)
          break
        case 'file.save':
          void state.save()
          break
        case 'file.saveAs':
          void state.saveAs()
          break
        case 'file.printPdf': {
          const doc = state.document
          if (!editor || !doc) break
          void exportPdf(editor, doc, state.fileName())
            .then((result) => {
              if (result.path) {
                state.setError(null)
              }
            })
            .catch((err: unknown) => {
              state.setError(
                `PDF を出力できませんでした: ${err instanceof Error ? err.message : String(err)}`
              )
            })
          break
        }
        case 'edit.undo':
          editor?.chain().focus().undo().run()
          break
        case 'edit.redo':
          editor?.chain().focus().redo().run()
          break
        case 'edit.find':
          toggleFind(true)
          break
        case 'edit.selectAll':
          editor?.chain().focus().selectAll().run()
          break
        case 'review.toggleTracking':
          setTracking()
          break
        case 'review.applyAll':
          runEditorCommand(editor, 'applyAllRevisions', cmd.action)
          break
        case 'review.goto':
          runEditorCommand(editor, 'gotoRevision', cmd.direction)
          break
        case 'review.toggleComments':
          toggleComments()
          break
        case 'view.zoom':
          nudgeZoom(cmd.delta)
          break
        case 'help.about':
          void window.wowd
            .getAppInfo()
            .then((info) =>
              window.wowd.reportError('Wowd', `バージョン ${info.version} / ${info.platform}`)
            )
          break
      }
    }
    return window.wowd.onMenuCommand(handler)
  }, [editor, toggleFind, nudgeZoom, setTracking, toggleComments])

  // ファイル関連付けや「アプリで開く」からの起動
  useEffect(() => {
    return window.wowd.onOpenFileRequest((path) => {
      void useDocumentStore.getState().openPath(path)
    })
  }, [])

  // main 側の終了確認に答える
  useEffect(() => {
    return window.wowd.onQueryDirty(() => useDocumentStore.getState().dirty)
  }, [])

  return (
    <div className="app">
      <Ribbon editor={editor} />

      <RecoveryBanner />

      {store.error && (
        <div className="banner banner-error" role="alert">
          <span>{store.error}</span>
          <button type="button" onClick={() => store.setError(null)}>
            {t.dialog.close}
          </button>
        </div>
      )}

      {store.unsupported.length > 0 && (
        <div className="banner banner-warn" role="status">
          <div>
            <strong>{t.file.unsupportedTitle}</strong>
            <div className="banner-detail">{store.unsupported.join(', ')}</div>
            <div className="banner-detail">{t.file.unsupportedBody}</div>
          </div>
          <button type="button" onClick={store.dismissUnsupported}>
            {t.dialog.close}
          </button>
        </div>
      )}

      <main className="app-body">
        <WowdEditor onReady={onReady} />
        <FindReplace editor={editor} />
        <CommentsPane editor={editor} />
      </main>

      <RubyDialog
        editor={editor}
        open={dialog === 'ruby'}
        onClose={() => openDialog(null)}
      />
      <PageSetupDialog open={dialog === 'pageSetup'} onClose={() => openDialog(null)} />

      <StatusBar editor={editor} />
    </div>
  )
}

/** 型の緩いエディタコマンドを名前で呼ぶ。校閲メニューから使う */
function runEditorCommand(editor: Editor | null, name: string, arg: unknown): void {
  if (!editor) return
  const commands = editor.commands as unknown as Record<string, (a: unknown) => boolean>
  commands[name]?.(arg)
}
