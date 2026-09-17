import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { buildExtensions } from './extensions'
import { fromWowdDoc } from './serialize/fromWowdDoc'
import { toWowdDoc } from './serialize/toWowdDoc'
import { useDocumentStore } from '../store/document'
import { useUiStore } from '../store/ui'
import { paragraphAttrsToStyle } from '@core/css/paragraphCss'
import { fontsToCss } from '@core/css/runCss'
import { halfPtToPt, twipToPt } from '@shared/units'
import type { WowdResources, SectionProps } from '@core/model/types'
import { defaultSection } from '@core/docx/read/section'
import { buildStyleSheet } from '@core/css/styleSheet'

/**
 * 文書本体のエディタ。
 *
 * 表示は今はページ分割なしの連続スクロール (下書き表示)。
 * ページ表示とヘッダー/フッターは Phase 5 で載せる。
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
  /** 文書差し替え中に onUpdate が走って dirty が立つのを防ぐ */
  const loading = useRef(false)

  const editor = useEditor({
    extensions: buildExtensions(),
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
      editor.commands.setContent(fromWowdDoc(loaded.doc) as never, { emitUpdate: false })
      // リストの行頭記号を描くために numbering.xml をプラグインへ渡す
      ;(editor.commands as unknown as { setNumberingTable: (t: unknown) => void }).setNumberingTable(
        loaded.resources.numbering
      )
    } finally {
      loading.current = false
    }
  }, [editor, loadToken])

  // 文書の読み込みに失敗しても紙は描く。幅ゼロで何も見えなくなるのを避けるため
  const style = pageStyle(resources)

  // styles.xml 由来の見た目。文書を読み込んだときだけ作り直す
  const styleSheet = useMemo(
    () => (resources ? buildStyleSheet(resources.styles) : ''),
    [resources]
  )

  return (
    <div className="wowd-viewport">
      {styleSheet && <style data-wowd-styles="">{styleSheet}</style>}
      <div className="wowd-page" style={{ ...style, zoom: `${zoom}%` }} data-testid="wowd-page">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

/**
 * セクション設定から用紙サイズと余白、既定フォントを CSS にする。
 * ページ分割はまだ無いので「幅と余白だけ本物」の 1 枚の紙として描く。
 */
function pageStyle(resources: WowdResources | null): React.CSSProperties {
  const section: SectionProps = resources?.sections[0] ?? defaultSection('fallback')
  const rPr = resources?.styles.docDefaults.rPr ?? null
  const family = fontsToCss(rPr?.rFonts ?? null)

  const base: React.CSSProperties = {
    width: `${twipToPt(section.pgSz.w)}pt`,
    paddingTop: `${twipToPt(section.pgMar.top)}pt`,
    paddingBottom: `${twipToPt(section.pgMar.bottom)}pt`,
    paddingLeft: `${twipToPt(section.pgMar.left)}pt`,
    paddingRight: `${twipToPt(section.pgMar.right)}pt`
  }
  if (family) base.fontFamily = family
  if (rPr?.sz != null) base.fontSize = `${halfPtToPt(rPr.sz)}pt`

  const defaultParagraph = resources?.styles.docDefaults.pPr ?? null
  if (defaultParagraph) {
    const lineHeight = extractLineHeight(paragraphAttrsToStyle(defaultParagraph))
    if (lineHeight) base.lineHeight = lineHeight
  }
  return base
}

function extractLineHeight(css: string): string | undefined {
  return /line-height:([^;]+)/.exec(css)?.[1]
}
