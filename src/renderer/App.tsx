import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Ribbon } from './components/Ribbon'
import { StatusBar } from './components/StatusBar'
import { FindReplace } from './components/FindReplace'
import { CommentsPane } from './components/CommentsPane'
import { RubyDialog } from './components/dialogs/RubyDialog'
import { PageSetupDialog } from './components/dialogs/PageSetupDialog'
import { HeaderFooterDialog } from './components/dialogs/HeaderFooterDialog'
import { WowdEditor } from './editor/Editor'
import { useDocumentStore } from './store/document'
import { useUiStore } from './store/ui'
import { t } from './i18n/ja'
import type { MenuCommand } from '@shared/ipc'
import { exportPdf, registerPrintSource } from './print/exportPdf'
import { startAutosave, saveRecoveryNow } from './store/autosave'
import { RecoveryBanner } from './components/RecoveryBanner'
import { platform } from './platform'
import { useLayoutSize } from './hooks/useIsMobile'
import { MobileTopBar, MobileBottomBar } from './components/mobile/MobileShell'

export function App(): React.JSX.Element {
  const [editor, setEditor] = useState<Editor | null>(null)

  const store = useDocumentStore()
  const toggleFind = useUiStore((s) => s.toggleFind)
  const setViewMode = useUiStore((s) => s.setViewMode)
  const size = useLayoutSize()
  const mobile = size === 'compact'

  // スマホでは最初だけ下書き表示にする。A4 の紙を縮めると字が読めないので、
  // 読むには画面の幅で折り返す下書き表示が向く。切り替えは利用者に任せる
  const appliedMobileDefault = useRef(false)
  useEffect(() => {
    if (!mobile || appliedMobileDefault.current) return
    appliedMobileDefault.current = true
    setViewMode('draft')
  }, [mobile, setViewMode])
  const overflowingTables = useUiStore((s) => s.overflowingTables)
  const dialog = useUiStore((s) => s.dialog)
  const openDialog = useUiStore((s) => s.openDialog)
  const nudgeZoom = useUiStore((s) => s.nudgeZoom)
  const setTracking = useUiStore((s) => s.setTracking)
  const toggleComments = useUiStore((s) => s.toggleComments)
  const toggleRuler = useUiStore((s) => s.toggleRuler)
  const toggleTrimMarks = useUiStore((s) => s.toggleTrimMarks)

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
        case 'view.toggleRuler':
          toggleRuler()
          break
        case 'view.toggleTrimMarks':
          toggleTrimMarks()
          break
        case 'help.about':
          void platform
            .getAppInfo()
            .then((info) =>
              platform.reportError('Wowd', `バージョン ${info.version} / ${info.platform}`)
            )
          break
      }
    }
    return platform.onMenuCommand(handler)
  }, [editor, toggleFind, nudgeZoom, setTracking, toggleComments, toggleRuler, toggleTrimMarks])

  // ファイル関連付けや「アプリで開く」からの起動
  useEffect(() => {
    return platform.onOpenFileRequest((path) => {
      void useDocumentStore.getState().openPath(path)
    })
  }, [])

  // main 側の終了確認に答える
  useEffect(() => {
    return platform.onQueryDirty(() => useDocumentStore.getState().dirty)
  }, [])

  return (
    // 画面の広さは CSS からも使う。判定を JS と CSS の 2 か所に書くと必ずずれるので、
    // 決めるのは useLayoutSize だけにして、結果を属性で渡す
    <div className={mobile ? 'app is-mobile' : 'app'} data-size={size}>
      {mobile ? <MobileTopBar editor={editor} /> : <Ribbon editor={editor} />}

      <RecoveryBanner />

      {store.error && (
        <div className="banner banner-error" role="alert">
          <span>{store.error}</span>
          <button type="button" onClick={() => store.setError(null)}>
            {t.dialog.close}
          </button>
        </div>
      )}

      {overflowingTables > 0 && (
        <div className="banner banner-warn" role="status">
          <div>
            <strong>{t.file.overflowTableTitle}</strong>
            <div className="banner-detail">{t.file.overflowTableBody}</div>
          </div>
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
      <HeaderFooterDialog open={dialog === 'headerFooter'} onClose={() => openDialog(null)} />

      {mobile ? <MobileBottomBar editor={editor} /> : <StatusBar editor={editor} />}
    </div>
  )
}

/** 型の緩いエディタコマンドを名前で呼ぶ。校閲メニューから使う */
function runEditorCommand(editor: Editor | null, name: string, arg: unknown): void {
  if (!editor) return
  const commands = editor.commands as unknown as Record<string, (a: unknown) => boolean>
  commands[name]?.(arg)
}
