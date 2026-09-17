import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { buildExtensions } from './extensions'
import { fromWowdDoc } from './serialize/fromWowdDoc'
import { toWowdDoc } from './serialize/toWowdDoc'
import { useDocumentStore } from '../store/document'
import { useUiStore } from '../store/ui'
import { fontsToCss } from '@core/css/runCss'
import { buildStyleSheet } from '@core/css/styleSheet'
import { halfPtToPt } from '@shared/units'
import type { WowdResources, SectionProps } from '@core/model/types'
import { defaultSection } from '@core/docx/read/section'
import { pageGeometry, toPx } from '@core/layout/pageGeometry'
import { gridFromSection, normalSizeOf, manuscriptCell } from '@core/layout/grid'
import { mediaRegistry } from './media'
import { PaginationExtension } from './pagination/PaginationExtension'
import { PageChrome } from './pagination/PageChrome'
import { PAGE_GAP, EMPTY_LAYOUT, type PageLayout } from './pagination/types'

/**
 * 文書本体のエディタ。
 *
 * 本文は単一の連続フローとして描き、ページ分割は
 * スペーサーの Decoration と、別レイヤの用紙下地で表現する。
 * 文書ツリーには手を入れないので、保存される内容は表示モードに左右されない。
 */
export function WowdEditor({
  onReady
}: {
  onReady: (editor: Editor | null) => void
}): React.JSX.Element {
  // document 全体ではなく loadToken と resources だけを見る。
  // document の参照は編集のたびに変わるので、それを見ると毎打鍵で再描画されてしまう。
  const loadToken = useDocumentStore((s) => s.loadToken)
  const resources = useDocumentStore((s) => s.document?.resources ?? null)
  const markDirty = useDocumentStore((s) => s.markDirty)
  const setDocProvider = useDocumentStore((s) => s.setDocProvider)

  const zoom = useUiStore((s) => s.zoom)
  const viewMode = useUiStore((s) => s.viewMode)
  const showGrid = useUiStore((s) => s.showGrid)
  const tracking = useUiStore((s) => s.tracking)
  const author = useUiStore((s) => s.author)
  const revisionDisplay = useUiStore((s) => s.revisionDisplay)
  const setPageInfo = useUiStore((s) => s.setPageInfo)

  /** 文書差し替え中に onUpdate が走って dirty が立つのを防ぐ */
  const loading = useRef(false)
  const [layout, setLayout] = useState<PageLayout>(EMPTY_LAYOUT)

  const handleLayout = useCallback(
    (next: PageLayout) => {
      setLayout(next)
      setPageInfo(1, Math.max(1, next.pages.length))
    },
    [setPageInfo]
  )

  // 拡張一覧は初回だけ作る。毎回作り直すとエディタが再生成される
  const [extensions] = useState(() => [...buildExtensions(), PaginationExtension])

  const editor = useEditor({
    extensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { class: 'wowd-content', spellcheck: 'false', lang: 'ja' }
    },
    onUpdate() {
      if (loading.current) return
      // ここで全文を変換すると打鍵ごとに O(文書長) かかる。変換は保存時にだけ行う
      markDirty()
    }
  })

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  // 画面を閉じるときに blob URL を解放する
  useEffect(() => () => mediaRegistry.clear(), [])

  /**
   * ページ分割の前提が変わったらプラグインに知らせる。
   *
   * ref を更新しただけではプラグインは動かないので、
   * 何も変えないトランザクションを投げて再計算のきっかけを作る。
   */
  useEffect(() => {
    if (!editor) return
    ;(
      editor.commands as unknown as { setPaginationConfig: (c: unknown) => void }
    ).setPaginationConfig({
      section: resources?.sections[0] ?? null,
      enabled: viewMode === 'print',
      onLayout: handleLayout
    })
    // 設定を変えただけではプラグインは動かないので、
    // 何も変えないトランザクションで再計算のきっかけを作る
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  }, [editor, resources, viewMode, handleLayout])

  /**
   * 変更履歴の設定をプラグインへ渡す。
   *
   * 記録の可否と著者名はプラグインが編集のたびに読むので、
   * 拡張の storage に置く。書き換えはコマンド経由で行う
   * (エディタから取り出した値を直接書き換えるのは避ける)。
   */
  useEffect(() => {
    if (!editor) return
    const commands = editor.commands as unknown as {
      setTrackChanges: (on: boolean) => void
      setRevisionAuthor: (name: string) => void
    }
    commands.setTrackChanges(tracking)
    commands.setRevisionAuthor(author)
  }, [editor, tracking, author])

  // 保存時に最新のツリーを引き出せるようにする
  useEffect(() => {
    if (!editor) return
    setDocProvider(() => toWowdDoc(editor.getJSON() as never))
    return () => setDocProvider(null)
  }, [editor, setDocProvider])

  /**
   * 文書を読み込んだときだけ内容を差し替える。
   *
   * setContent は Undo 履歴を捨てるので、編集のたびに走らせてはいけない。
   * (走らせると「元に戻す」の直後に「やり直し」ができなくなる。)
   */
  useEffect(() => {
    if (!editor) return
    const loaded = useDocumentStore.getState().document
    if (!loaded) return
    loading.current = true
    try {
      // 画像を blob URL にしてから内容を差し替える。
      // 逆順だと最初の描画で画像が出ない
      mediaRegistry.load(loaded.resources)
      editor.commands.setContent(fromWowdDoc(loaded.doc) as never, { emitUpdate: false })
      // リストの行頭記号を描くために numbering.xml をプラグインへ渡す
      ;(editor.commands as unknown as { setNumberingTable: (t: unknown) => void }).setNumberingTable(
        loaded.resources.numbering
      )
    } catch (err) {
      // スキーマに無いノードがあると ProseMirror が例外を投げる。
      // このときエディタには前の文書が残ったままなので、
      // そのまま保存すると開いたファイルが別物で上書きされてしまう。
      // 保存を止めてから知らせる。黙って壊すより中断する方がましなため。
      useDocumentStore
        .getState()
        .blockSaving(
          `文書を表示できませんでした: ${err instanceof Error ? err.message : String(err)}`
        )
    } finally {
      loading.current = false
    }
  }, [editor, loadToken])

  const section = resources?.sections[0] ?? defaultSection('fallback')
  const geometry = useMemo(() => toPx(pageGeometry(section)), [section])
  const flowStyle = useMemo(
    () => flowCss(resources, section, geometry, viewMode === 'print'),
    [resources, section, geometry, viewMode]
  )

  // styles.xml 由来の見た目。文書を読み込んだときだけ作り直す
  const styleSheet = useMemo(
    () => (resources ? buildStyleSheet(resources.styles) : ''),
    [resources]
  )

  const gridCss = useMemo(
    () => (showGrid ? manuscriptGridCss(resources, section) : null),
    [showGrid, resources, section]
  )

  const isPrintView = viewMode === 'print'
  // ページ分割の結果に合わせてスクロール領域の高さを確保する
  const naturalHeight =
    isPrintView && layout.pages.length > 0
      ? layout.pages.length * layout.stride - PAGE_GAP
      : undefined

  /**
   * 拡大縮小は transform で行う。CSS の zoom は使わない。
   *
   * Chromium の zoom はレイアウトに影響する (フォントサイズを実際に変えて
   * 行分割をやり直す) ので、倍率を変えるだけで改ページ位置が動いてしまう。
   * それでは「画面の見た目と PDF 出力が一致する」という前提が崩れる。
   * transform は見た目だけを拡大するので、実測値も改ページ位置も変わらない。
   */
  const scale = snapScale(zoom / 100)

  return (
    <div className="wowd-viewport" data-view-mode={viewMode} data-revisions={revisionDisplay}>
      {styleSheet && <style data-wowd-styles="">{styleSheet}</style>}
      {/* 変形後の実寸を外枠に持たせないとスクロール量が合わない */}
      <div
        className="wowd-scaler-box"
        style={{
          width: geometry.pageInline * scale,
          height: naturalHeight != null ? naturalHeight * scale : undefined
        }}
      >
        <div
          className="wowd-scaler"
          style={{ transform: `scale(${scale})`, width: geometry.pageInline }}
        >
          <div
            className={isPrintView ? 'wowd-stage' : 'wowd-stage wowd-stage-draft'}
            style={{ width: geometry.pageInline, height: naturalHeight }}
            data-testid="wowd-page"
          >
            {isPrintView && <PageChrome layout={layout} resources={resources} />}
            <div
              className="wowd-flow"
              style={{ ...flowStyle, ...(gridCss ?? {}) }}
              data-testid="wowd-flow"
            >
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 端数の倍率は文字がにじむので 1/64 刻みに丸める。見た目には分からない */
function snapScale(scale: number): number {
  return Math.round(scale * 64) / 64
}

/**
 * 本文フローの寸法。
 * 印刷レイアウトでは用紙の余白ぶんだけ内側に寄せ、下書きでは軽い余白だけにする。
 */
function flowCss(
  resources: WowdResources | null,
  section: SectionProps,
  geometry: ReturnType<typeof toPx>,
  isPrintView: boolean
): React.CSSProperties {
  const rPr = resources?.styles.docDefaults.rPr ?? null
  const family = fontsToCss(rPr?.rFonts ?? null)

  const base: React.CSSProperties = isPrintView
    ? {
        width: geometry.pageInline,
        paddingTop: geometry.marginBefore,
        paddingBottom: geometry.marginAfter,
        paddingLeft: geometry.marginStart,
        paddingRight: geometry.marginEnd
      }
    : {
        width: geometry.textInline + 96,
        padding: 48
      }

  if (family) base.fontFamily = family
  if (rPr?.sz != null) base.fontSize = `${halfPtToPt(rPr.sz)}pt`

  // 文字数と行数が指定された文書では行送りを固定する。
  // これを入れないと 1 ページあたりの行数が指定どおりにならない
  const grid = gridFromSection(section, normalSizeOf(rPr?.sz))
  if (grid && grid.linePitchPt > 0) base.lineHeight = `${grid.linePitchPt}pt`

  void section
  return base
}

/**
 * 原稿用紙のマス目。背景のグラデーションで描くので描画コストはほぼゼロ。
 */
function manuscriptGridCss(
  resources: WowdResources | null,
  section: SectionProps
): React.CSSProperties | null {
  const rPr = resources?.styles.docDefaults.rPr ?? null
  const cell = manuscriptCell(gridFromSection(section, normalSizeOf(rPr?.sz)))
  if (!cell) return null

  const w = `${cell.widthPt}pt`
  const h = `${cell.heightPt}pt`
  return {
    backgroundImage: `repeating-linear-gradient(to right, rgba(120,150,200,.35) 0 1px, transparent 1px ${w}), repeating-linear-gradient(to bottom, rgba(120,150,200,.35) 0 1px, transparent 1px ${h})`,
    backgroundSize: `${w} ${h}`,
    backgroundOrigin: 'content-box',
    backgroundClip: 'content-box',
    backgroundRepeat: 'repeat'
  }
}
