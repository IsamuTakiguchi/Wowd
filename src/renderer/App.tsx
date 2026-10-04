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
import { TabBar } from './components/TabBar'
import { handleOkaguchiKey } from './okaguchi/keys'
import { handleWordKey } from './word/keys'
import { startFormatPainterListener } from './word/actions'
import { NavigationPane } from './word/NavigationPane'
import { WordDialogs } from './word/WordDialogs'
import { ContextMenu } from './word/ContextMenu'
import { Notice } from './components/Notice'
import { OkaguchiDialogs } from './okaguchi/OkaguchiDialogs'
import { useTabsStore, nameFirstDocument } from './store/tabs'
import { startFileAutosave } from './store/fileAutosave'

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
  const formatPainter = useUiStore((s) => s.formatPainter)
  const openDialog = useUiStore((s) => s.openDialog)
  const nudgeZoom = useUiStore((s) => s.nudgeZoom)
  const setTracking = useUiStore((s) => s.setTracking)
  const toggleComments = useUiStore((s) => s.toggleComments)
  const toggleRuler = useUiStore((s) => s.toggleRuler)
  const toggleTrimMarks = useUiStore((s) => s.toggleTrimMarks)

  const onReady = useCallback((next: Editor | null) => {
    setEditor(next)
    // E2E から段落の属性や選択位置を確かめるための入口
    ;(window as unknown as { __wowdEditor: unknown }).__wowdEditor = next
  }, [])

  // 印刷はメニューからも E2E からも叩けるよう、現在の対象を登録しておく
  useEffect(() => {
    registerPrintSource(editor, store.document, store.fileName())
  }, [editor, store])

  // 起動時は空の A4 文書を開く。タブが何枚あっても見分けられるよう「文書1」と名付ける
  useEffect(() => {
    nameFirstDocument()
    void useDocumentStore.getState().newDocument('blank-a4')
  }, [])

  // 自動保存 (元のファイルへの上書き)。オフの間は何もしない
  useEffect(() => startFileAutosave(), [])

  /**
   * タブの切り替え。Excel と同じく Ctrl+PageDown で次、Ctrl+PageUp で前。
   *
   * エディタの中で押されても効くように、窓全体で先に受ける (capture)。
   * ProseMirror はこの組み合わせを使っていないので、横取りしても困らない
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // F12 は「名前を付けて保存」(Word と同じ)
      if (e.key === 'F12' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        void useDocumentStore.getState().saveAs()
        return
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const tabs = useTabsStore.getState()
      if (!e.shiftKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
        e.preventDefault()
        tabs.cycle(e.key === 'PageDown' ? 1 : -1)
        return
      }
      // Ctrl+Tab / Ctrl+Shift+Tab でも移る (Excel でブックを切り替えるキー)
      if (e.key === 'Tab') {
        e.preventDefault()
        tabs.cycle(e.shiftKey ? -1 : 1)
        return
      }
      // Ctrl+W / Ctrl+F4 でいまのタブを閉じる (Excel でブックを閉じるキー)。
      // ブラウザ版の Ctrl+W はブラウザが先に取るので、ここに来るのはアプリ版だけ
      if (!e.shiftKey && (e.key.toLowerCase() === 'w' || e.key === 'F4')) {
        e.preventDefault()
        void tabs.closeTab(tabs.activeId)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  /**
   * Word のキー (Ctrl+Shift+> でフォント拡大、Ctrl+Q で段落書式の解除など)。
   * エディタより先に受ける。ProseMirror の既定 (Ctrl+[ など) より Word の動きを優先する
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      handleWordKey(e, editor)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editor])

  // 書式のコピー / 貼り付け (ブラシ)。待っている間に本文でマウスを離したら当てる
  useEffect(() => startFormatPainterListener(() => editor), [editor])

  /**
   * 岡口マクロのキー (Alt+R, Alt+1〜8 など)。
   *
   * エディタより先に受ける (capture)。Alt+R を止めないと、メニューの「校閲(&R)」が開く
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      handleOkaguchiKey(e, editor)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editor])

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
        // 新規作成も開くのも新しいタブに。いまの文書を閉じさせない (Excel のブックと同じ)
        case 'file.new':
          void useTabsStore.getState().newTab(cmd.template)
          break
        case 'file.open':
          void useTabsStore.getState().openDialog()
          break
        case 'file.openRecent':
          void useTabsStore.getState().openPath(cmd.path)
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
      void useTabsStore.getState().openPath(path)
    })
  }, [])

  // main 側の終了確認に答える
  useEffect(() => {
    // 裏に回したタブも数える。表の文書だけ見ていると、裏のタブの編集が黙って消える
    return platform.onQueryDirty(() => useTabsStore.getState().anyDirty())
  }, [])

  return (
    // 画面の広さは CSS からも使う。判定を JS と CSS の 2 か所に書くと必ずずれるので、
    // 決めるのは useLayoutSize だけにして、結果を属性で渡す
    <div
      className={['app', mobile ? 'is-mobile' : '', formatPainter ? 'is-format-painter' : ''].filter(Boolean).join(' ')}
      data-size={size}
    >
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
        {!mobile && <NavigationPane editor={editor} />}
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
      <OkaguchiDialogs editor={editor} />
      <WordDialogs editor={editor} />
      <ContextMenu editor={editor} />

      <Notice />
      <TabBar compact={mobile} />
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
