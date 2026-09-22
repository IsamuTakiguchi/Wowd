import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { buildExtensions } from './extensions'
import { Selection } from '@tiptap/pm/state'
import { fromWowdDoc } from './serialize/fromWowdDoc'
import { toWowdDoc } from './serialize/toWowdDoc'
import { useDocumentStore } from '../store/document'
import { useUiStore } from '../store/ui'
import { useIsMobile } from '../hooks/useIsMobile'
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
import { trimMarkLayout } from '@core/layout/trimMarks'
import { twipToCssPx } from '@core/layout/pageGeometry'
import { HorizontalRuler, VerticalRuler } from '../components/Ruler'

/**
 * 窓の端と紙のあいだに残す余白 (px)。
 * ぴったりに詰めると縦スクロールバーが出た瞬間に横スクロールも出る
 */
const VIEWPORT_GUTTER = 24

/**
 * 縦ルーラのために紙の左に空けておく幅 (px)。
 *
 * 空けないと、窓が狭いときに紙が左端まで寄ってルーラが切れる。
 * 「出しているのに読めない」より、そのぶん紙を縮めるほうがまし
 */
const VERTICAL_RULER_RESERVE = 28

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
  const zoomMode = useUiStore((s) => s.zoomMode)
  const setEffectiveZoom = useUiStore((s) => s.setEffectiveZoom)
  const viewMode = useUiStore((s) => s.viewMode)
  const showGrid = useUiStore((s) => s.showGrid)
  const showRuler = useUiStore((s) => s.showRuler)
  const showTrimMarks = useUiStore((s) => s.showTrimMarks)
  const tracking = useUiStore((s) => s.tracking)
  const author = useUiStore((s) => s.author)
  const revisionDisplay = useUiStore((s) => s.revisionDisplay)
  const setPageInfo = useUiStore((s) => s.setPageInfo)
  const setOverflowingTables = useUiStore((s) => s.setOverflowingTables)
  const mobile = useIsMobile()

  /**
   * 紙が窓に収まらないときは、収まる倍率まで縮める。
   *
   * A4 は 794px あり、412px の画面では右側が見えない (実測した)。
   * スマホに限った話ではなく、窓を半分にしたパソコンでも同じことが起きる。
   * 画面の幅は回転でも窓の操作でも変わるので、ResizeObserver で追う。
   *
   * **端末の種類では分けない。** 実際の幅だけを見る
   */
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = (): void => setViewportWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /** 文書差し替え中に onUpdate が走って dirty が立つのを防ぐ */
  const loading = useRef(false)
  const [layout, setLayout] = useState<PageLayout>(EMPTY_LAYOUT)

  const handleLayout = useCallback(
    (next: PageLayout) => {
      setLayout(next)
      setPageInfo(1, Math.max(1, next.pages.length))
      setOverflowingTables(next.overflow.tables)
    },
    [setPageInfo, setOverflowingTables]
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

  /**
   * 紙の上の、本文ではない場所をクリックしたときにカーソルを置く。
   *
   * ProseMirror が扱うのは本文 (.wowd-content) の中のクリックだけ。
   * 用紙の余白や、短い文書の下に広がる何もない所を押すと
   * **フォーカスが外れ、打っても何も入らない。**
   * 新規文書は本文が先頭の 1 行しか無いので、紙の真ん中を押して
   * 何も起きないのが最初の体験になってしまう。実機で報告があった。
   *
   * Word と同じく、いちばん近い本文の位置にカーソルを置く。
   * 横は本文の幅に収めるので、左の余白なら行頭、右の余白なら行末に付く。
   * 縦は本文の中に収めるので、本文より下なら最後の行、上なら先頭の行に付く。
   */
  const handleStageMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!editor || e.button !== 0) return
      const content = editor.view.dom
      // 本文の中は ProseMirror に任せる。ここで奪うと範囲選択ができなくなる
      if (content.contains(e.target as Node)) return

      const box = content.getBoundingClientRect()
      const left = Math.min(Math.max(e.clientX, box.left + 1), box.right - 1)
      const top = Math.min(Math.max(e.clientY, box.top + 1), box.bottom - 1)
      const found = editor.view.posAtCoords({ left, top })
      const { doc } = editor.state
      const pos = found ? found.pos : e.clientY < box.top ? 0 : doc.content.size
      // 段落の境目などテキストの無い位置に当たることがあるので、近い位置へ寄せる
      const selection = Selection.near(doc.resolve(Math.min(pos, doc.content.size)), e.clientY < box.top ? 1 : -1)

      // 既定の動作に任せると、ブラウザがフォーカスを紙の div へ移してしまう
      e.preventDefault()
      editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView())
      editor.view.focus()
    },
    [editor]
  )

  // 画面を閉じるときに blob URL を解放する
  useEffect(() => () => mediaRegistry.clear(), [])

  const section = resources?.sections[0] ?? defaultSection('fallback')
  const geometry = useMemo(() => toPx(pageGeometry(section)), [section])

  const isPrintView = viewMode === 'print'

  /**
   * 裁ちトンボのぶん、紙が四辺に広がる量 (px)。
   *
   * 印刷レイアウトのときだけ効く。下書き表示には紙が無いので出しようがない。
   * この値が 0 でなければ、紙も舞台もこのぶん大きくなる。
   */
  const trimOffset = useMemo(
    () =>
      showTrimMarks && isPrintView
        ? twipToCssPx(
            trimMarkLayout({ finishInline: section.pgSz.w, finishBlock: section.pgSz.h }).offset
          )
        : 0,
    [showTrimMarks, isPrintView, section]
  )

  /**
   * ページ間の隙間。
   *
   * トンボを出すと紙が上下に広がるので、隙間も広げないと隣の紙と重なる。
   * 広げたぶんはスペーサーの高さにも効くので、本文の落ちる位置は変わらない。
   */
  const pageGap = PAGE_GAP + trimOffset * 2

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
      pageGap,
      onLayout: handleLayout
    })
    // 設定を変えただけではプラグインは動かないので、
    // 何も変えないトランザクションで再計算のきっかけを作る
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  }, [editor, resources, viewMode, pageGap, handleLayout])

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

  const flowStyle = useMemo(
    () => flowCss(resources, section, geometry, viewMode === 'print', mobile),
    [resources, section, geometry, viewMode, mobile]
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

  // ページ分割の結果に合わせてスクロール領域の高さを確保する。
  // 最後の紙の下に隙間は要らないが、トンボのぶんは要る
  const naturalHeight =
    isPrintView && layout.pages.length > 0
      ? layout.pages.length * layout.stride - layout.gap + trimOffset * 2
      : undefined

  /**
   * 拡大縮小は transform で行う。CSS の zoom は使わない。
   *
   * Chromium の zoom はレイアウトに影響する (フォントサイズを実際に変えて
   * 行分割をやり直す) ので、倍率を変えるだけで改ページ位置が動いてしまう。
   * それでは「画面の見た目と PDF 出力が一致する」という前提が崩れる。
   * transform は見た目だけを拡大するので、実測値も改ページ位置も変わらない。
   */
  // スマホの下書き表示は紙の幅を捨てて、画面いっぱいに流す。
  // トンボを出すときは紙が左右に広がるので、舞台もそのぶん広げる
  const stageWidth =
    mobile && !isPrintView ? undefined : geometry.pageInline + trimOffset * 2

  /**
   * 窓に収まる倍率。
   *
   * A4 は 794px あるので、窓を狭めるとすぐ紙が右へはみ出す。
   * 収まらないときだけ縮める。収まるなら 100% のまま拡大はしない
   * (勝手に大きくすると、窓を広げただけで文字の大きさが変わって驚く)。
   */
  const rulerReserve = isPrintView && showRuler && !mobile ? VERTICAL_RULER_RESERVE : 0
  const fitScale =
    isPrintView && viewportWidth > 0 && stageWidth != null
      ? Math.min(1, (viewportWidth - VIEWPORT_GUTTER - rulerReserve) / stageWidth)
      : 1

  /**
   * 実際に掛ける倍率。
   *
   * 既定 (auto) は「収まらないときだけ縮める」。
   * 倍率に触れた時点で manual になり、以後は指定どおりにする。
   * ただしスマホでは指でつまんで直せないので、常に幅に合わせる。
   */
  const scale = snapScale(mobile || zoomMode === 'auto' ? fitScale : zoom / 100)

  // 実際に掛かっている倍率をステータスバーへ。指定した値と食い違いうるので
  useEffect(() => {
    setEffectiveZoom(Math.round(scale * 100))
  }, [scale, setEffectiveZoom])

  return (
    <div
      className="wowd-viewport"
      ref={viewportRef}
      data-view-mode={viewMode}
      data-revisions={revisionDisplay}
      data-mobile={mobile ? 'true' : undefined}
      data-ruler={rulerReserve > 0 ? 'true' : undefined}
    >
      {styleSheet && <style data-wowd-styles="">{styleSheet}</style>}

      {/* ルーラは紙の外。倍率は座標に掛けてあるので、拡大しても線は太らない */}
      {isPrintView && showRuler && !mobile && stageWidth != null && (
        <HorizontalRuler
          editor={editor}
          geometry={geometry}
          scale={scale}
          offsetPx={trimOffset}
          stageWidth={stageWidth}
        />
      )}

      {/* 変形後の実寸を外枠に持たせないとスクロール量が合わない */}
      <div
        className="wowd-scaler-box"
        style={{
          width: stageWidth != null ? stageWidth * scale : undefined,
          height: naturalHeight != null ? naturalHeight * scale : undefined
        }}
      >
        {isPrintView &&
          showRuler &&
          !mobile &&
          layout.pages.map((page) => (
            <VerticalRuler
              key={page.index}
              geometry={geometry}
              scale={scale}
              offsetPx={trimOffset}
              top={page.top * scale}
            />
          ))}
        <div
          className="wowd-scaler"
          style={{ transform: `scale(${scale})`, width: stageWidth }}
        >
          <div
            className={isPrintView ? 'wowd-stage' : 'wowd-stage wowd-stage-draft'}
            style={{ width: stageWidth, height: naturalHeight, padding: trimOffset || undefined }}
            data-testid="wowd-page"
            onMouseDown={handleStageMouseDown}
          >
            {isPrintView && (
              <PageChrome layout={layout} resources={resources} trimOffset={trimOffset} />
            )}
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
  isPrintView: boolean,
  mobile = false
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
    : mobile
      ? {
          // スマホの下書き表示。紙の幅を持たず、画面の幅で折り返す
          width: '100%',
          boxSizing: 'border-box',
          padding: 16
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
