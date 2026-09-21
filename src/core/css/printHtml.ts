/**
 * 印刷 / PDF 用の HTML を組み立てる。
 *
 * 画面をそのまま印刷するのではなく、ページ分割の結果から
 * 「1 ページ 1 div」の静的な文書を作る。
 *
 * そうする理由:
 *   - 画面にはリボンもステータスバーも拡大用の transform も載っている
 *   - 本文は contenteditable で、スペーサーや行頭記号の Decoration が入っている
 *   - 何より、こちらが決めた改ページ位置で文字を割ってから出力するので、
 *     「画面の見た目と PDF が一致する」ことが結果的にではなく構造的に保証される
 *
 * DOM に依存しない文字列組み立てなので core に置き、素の Node でテストできる。
 */
import type {
  WowdDoc,
  BlockNode,
  InlineNode,
  SectionProps,
  StyleTable,
  RunProps,
  Mark,
  NumberingTable
} from '../model/types'
import { computeListMarkers, type ListMarker } from '../numbering/markers'
import { paragraphAttrsToStyle } from './paragraphCss'
import { runPropsToStyle, DEFAULT_RUN_PROPS, fontsToCss } from './runCss'
import { buildStyleSheet } from './styleSheet'
import { twipToMm, twipToPt, halfPtToPt } from '../../shared/units'
import { escapeXml } from '../docx/xml'
import { resolveField } from '../fields'
import { pickHeaderFooterRef } from '../layout/pageGeometry'
import { trimMarkLayout, trimMarkSvg, type TrimMarkLayout } from '../layout/trimMarks'
import { imageWrapStyle } from './imageCss'

export interface PrintPage {
  /** 1 始まりの表示ページ番号 */
  displayNumber: number
  section: SectionProps
  /** このページに載せるブロック */
  blocks: BlockNode[]
}

export interface PrintInput {
  pages: PrintPage[]
  styles: StyleTable
  headers: Map<string, WowdDoc>
  footers: Map<string, WowdDoc>
  /** 画像の内容を data URL で埋め込む。外部参照を作らないため */
  mediaDataUrls?: Map<string, string>
  /** リストの行頭記号を出すために要る */
  numbering?: NumberingTable | null
  title: string
  /**
   * 裁ちトンボを付ける。
   *
   * 付けると用紙は仕上がりサイズより一回り大きくなり、本文はその中央に載る。
   * 印刷所に入稿するときに使う。ふだんの印刷では付けない。
   */
  trimMarks?: boolean
}

/** 印刷用文書の本文に当てるスコープ。画面側とは別にする */
const BODY_SCOPE = '.wowd-print-body'

export function buildPrintHtml(input: PrintInput): string {
  const { pages, styles } = input
  const total = pages.length

  // セクションごとに @page 規則を作る。用紙サイズが混在する文書のため
  const sectionsUsed = new Map<string, SectionProps>()
  for (const page of pages) sectionsUsed.set(page.section.id, page.section)

  const pageRules = [...sectionsUsed.values()]
    .map((section) => {
      // トンボを付けると紙が大きくなる。@page も div もその寸法で出す
      const trim = trimLayoutFor(section, input)
      const w = twipToMm(trim ? trim.sheetInline : section.pgSz.w)
      const h = twipToMm(trim ? trim.sheetBlock : section.pgSz.h)
      // mm で出す。pt だと @page と div の幅が別々に丸められ、
      // 1 枚ごとに数 px の余りページができる
      return [
        `@page ${cssIdent(section.id)} { size: ${round(w)}mm ${round(h)}mm; margin: 0 }`,
        `.wowd-print-page[data-section="${escapeAttr(section.id)}"] { page: ${cssIdent(section.id)}; width: ${round(w)}mm; height: ${round(h)}mm }`
      ].join('\n')
    })
    .join('\n')

  // トンボを使うときだけ規則を出す。使わない文書に余計な CSS を混ぜない
  const trimCss =
    input.trimMarks === true
      ? [
          '/* トンボを付けたときの、仕上がりサイズの枠。本文はこの中に収める */',
          '.wowd-print-trim-area { position: absolute; overflow: hidden; }',
          '.wowd-print-marks { position: absolute; left: 0; top: 0; }'
        ].join('\n')
      : ''

  const defaultRun = styles.docDefaults.rPr
  const bodyFont = fontsToCss(defaultRun?.rFonts ?? null)
  const bodySize = defaultRun?.sz != null ? `${halfPtToPt(defaultRun.sz)}pt` : null

  const body = pages.map((page) => renderPage(page, input, total)).join('\n')

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeXml(input.title)}</title>
<style>
${pageRules}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
${bodyFont ? `  font-family: ${bodyFont};` : ''}
${bodySize ? `  font-size: ${bodySize};` : ''}
  color: #000;
  line-break: strict;
  word-break: normal;
  overflow-wrap: break-word;
  text-spacing-trim: normal;
  ruby-position: over;
  ruby-align: space-around;
}
.wowd-print-page {
  position: relative;
  overflow: hidden;
  break-after: page;
  background: #fff;
}
.wowd-list-marker { white-space: pre; }
${trimCss}
.wowd-print-page:last-child { break-after: auto; }
.wowd-print-body p, .wowd-print-body h1, .wowd-print-body h2, .wowd-print-body h3,
.wowd-print-body h4, .wowd-print-body h5, .wowd-print-body h6 { margin: 0; }
.wowd-print-hf p { margin: 0; }
.wowd-print-tab { display: inline-block; white-space: pre; }
.wowd-print-body table { border-collapse: collapse; }
.wowd-print-body td, .wowd-print-body th { padding: 2pt 4pt; vertical-align: top; }
img { max-width: 100%; }
${buildStyleSheet(styles, BODY_SCOPE)}
</style>
</head>
<body>
${body}
</body>
</html>`
}

function renderPage(page: PrintPage, input: PrintInput, total: number): string {
  const { section } = page
  const marginStart = section.pgMar.left + section.pgMar.gutter
  const contentWidth = section.pgSz.w - marginStart - section.pgMar.right
  const evenAndOdd = Boolean(section.headerRefs.even ?? section.footerRefs.even)

  const headerId = pickHeaderFooterRef(
    section.headerRefs,
    page.displayNumber,
    section.titlePg,
    evenAndOdd
  )
  const footerId = pickHeaderFooterRef(
    section.footerRefs,
    page.displayNumber,
    section.titlePg,
    evenAndOdd
  )

  const fieldContext = {
    pageNumber: page.displayNumber,
    pageCount: total,
    pageNumberFormat: section.pgNumType?.fmt ?? 'decimal'
  }

  const header = headerId ? input.headers.get(headerId) : undefined
  const footer = footerId ? input.footers.get(footerId) : undefined

  const headerHtml = header
    ? `<div class="wowd-print-hf" style="position:absolute;top:${pt(section.pgMar.header)};left:${pt(marginStart)};width:${pt(contentWidth)}">${renderBlocks(header.content, input, fieldContext)}</div>`
    : ''
  const footerHtml = footer
    ? `<div class="wowd-print-hf" style="position:absolute;bottom:${pt(section.pgMar.footer)};left:${pt(marginStart)};width:${pt(contentWidth)}">${renderBlocks(footer.content, input, fieldContext)}</div>`
    : ''

  const bodyStyle = [
    'position:absolute',
    `top:${pt(section.pgMar.top)}`,
    `left:${pt(marginStart)}`,
    `width:${pt(contentWidth)}`,
    `height:${pt(section.pgSz.h - section.pgMar.top - section.pgMar.bottom)}`
  ].join(';')

  const inner = `${headerHtml}
<div class="wowd-print-body" style="${bodyStyle}">${renderBlocks(page.blocks, input, fieldContext)}</div>
${footerHtml}`

  const trim = trimLayoutFor(section, input)
  if (!trim) {
    return `<div class="wowd-print-page" data-section="${escapeAttr(section.id)}">
${inner}
</div>`
  }

  // 本文は仕上がりサイズの枠に入れ、その枠ごと紙の中央に置く。
  // 枠の中では left/top が仕上がりの角からの距離になるので、
  // ヘッダー・本文・フッターの指定はトンボの有無で変えなくてよい
  const sheetW = twipToMm(trim.sheetInline)
  const sheetH = twipToMm(trim.sheetBlock)
  const marks = trimMarkSvg(trim, { width: `${round(sheetW)}mm`, height: `${round(sheetH)}mm` })
  const areaStyle = [
    `left:${round(twipToMm(trim.offset))}mm`,
    `top:${round(twipToMm(trim.offset))}mm`,
    `width:${round(twipToMm(section.pgSz.w))}mm`,
    `height:${round(twipToMm(section.pgSz.h))}mm`
  ].join(';')

  return `<div class="wowd-print-page" data-section="${escapeAttr(section.id)}">
${marks.replace('<svg ', '<svg class="wowd-print-marks" ')}
<div class="wowd-print-trim-area" style="${areaStyle}">
${inner}
</div>
</div>`
}

/**
 * このセクションのトンボの寸法。付けない設定なら null。
 *
 * 仕上がりサイズはセクションごとに違いうるので、セクション単位で求める。
 */
function trimLayoutFor(section: SectionProps, input: PrintInput): TrimMarkLayout | null {
  if (input.trimMarks !== true) return null
  return trimMarkLayout({ finishInline: section.pgSz.w, finishBlock: section.pgSz.h })
}

interface FieldContext {
  pageNumber: number
  pageCount: number
  pageNumberFormat: string
}

function renderBlocks(blocks: BlockNode[], input: PrintInput, ctx: FieldContext): string {
  // 行頭記号は画面と同じ計算を使う。別々に実装すると番号が食い違う
  const markers = computeListMarkers(
    blocks.map((b) => ({ numPr: b.type === 'paragraph' ? b.attrs.numPr : null })),
    input.numbering ?? null
  )
  return blocks.map((block, i) => renderBlock(block, input, ctx, markers.get(i))).join('')
}

function renderBlock(
  block: BlockNode,
  input: PrintInput,
  ctx: FieldContext,
  marker?: ListMarker
): string {
  switch (block.type) {
    case 'paragraph': {
      // 印刷用の文書ではこちらが改ページを決めているので、
      // break-* を出すと Chromium が上から重ねて改ページしてしまう
      const style = paragraphAttrsToStyle(block.attrs, { fragmentation: false })
      const tag = headingTagOf(block.attrs.pStyle)
      const attrs = [
        style ? ` style="${escapeAttr(style)}"` : '',
        block.attrs.pStyle ? ` data-style="${escapeAttr(block.attrs.pStyle)}"` : ''
      ].join('')
      const markerHtml = marker
        ? `<span class="wowd-list-marker"${markerStyle(marker)}>${escapeXml(marker.text + marker.suffix)}</span>`
        : ''
      const inner = (block.content ?? []).map((n) => renderInline(n, input, ctx)).join('')
      // 空段落でも高さを持たせる
      return `<${tag}${attrs}>${markerHtml}${inner || (markerHtml ? '' : '<br>')}</${tag}>`
    }
    case 'table':
      return renderTable(block, input, ctx)
    case 'pageBreak':
    case 'sectionBreak':
      // 改ページはページの区切りそのものとして表現済み
      return ''
    case 'rawBlock':
      // 原文は保持しているが、描き方が分からないので印刷では出さない
      return ''
  }
}

function renderTable(
  table: Extract<BlockNode, { type: 'table' }>,
  input: PrintInput,
  ctx: FieldContext
): string {
  const colgroup =
    table.attrs.grid.length > 0
      ? `<colgroup>${table.attrs.grid.map((w) => `<col style="width:${pt(w)}">`).join('')}</colgroup>`
      : ''

  const rows = table.content
    .map((row) => {
      const cells = row.content
        .map((cell) => {
          if (cell.attrs.rowspan === 0) return '' // 上のセルに吸収されている
          const style: string[] = [`vertical-align:${cell.attrs.vAlign}`]
          if (cell.attrs.shd && cell.attrs.shd !== 'auto') {
            style.push(`background-color:#${cell.attrs.shd}`)
          }
          for (const [side, border] of Object.entries(cell.attrs.borders ?? {})) {
            if (!border || border.val === 'none' || border.val === 'nil') continue
            const color = border.color && border.color !== 'auto' ? `#${border.color}` : '#000'
            style.push(`border-${side}:${Math.max(0.5, border.sz / 8)}pt solid ${color}`)
          }
          const span = [
            cell.attrs.colspan > 1 ? ` colspan="${cell.attrs.colspan}"` : '',
            cell.attrs.rowspan > 1 ? ` rowspan="${cell.attrs.rowspan}"` : ''
          ].join('')
          return `<td${span} style="${escapeAttr(style.join(';'))}">${renderBlocks(cell.content, input, ctx)}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  return `<table style="width:100%">${colgroup}<tbody>${rows}</tbody></table>`
}

function renderInline(node: InlineNode, input: PrintInput, ctx: FieldContext): string {
  switch (node.type) {
    case 'text': {
      const style = inlineStyleOf(node.marks)
      const text = escapeXml(node.text)
      return style ? `<span style="${escapeAttr(style)}">${text}</span>` : text
    }
    case 'ruby':
      return `<ruby>${node.content.map((t) => escapeXml(t.text)).join('')}<rt>${escapeXml(node.attrs.rt)}</rt></ruby>`
    case 'wTab':
      return '<span class="wowd-print-tab">	</span>'
    case 'wBreak':
      return '<br>'
    case 'field': {
      const resolved = resolveField(node.attrs.instr, ctx)
      return escapeXml(resolved ?? node.attrs.cachedText)
    }
    case 'bookmark':
      return node.attrs.isEnd ? '' : `<a id="${escapeAttr(node.attrs.name)}"></a>`
    case 'image': {
      const src = input.mediaDataUrls?.get(node.attrs.mediaKey)
      if (!src) return ''
      const w = node.attrs.cx > 0 ? ` width="${Math.round(node.attrs.cx / 12700)}pt"` : ''
      const h = node.attrs.cy > 0 ? ` height="${Math.round(node.attrs.cy / 12700)}pt"` : ''
      // 回り込みは画面と同じ写し方をする。別々に書くと見た目が食い違う
      const wrap = imageWrapStyle(node.attrs)
      const style = wrap ? ` style="${escapeAttr(wrap)}"` : ''
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(node.attrs.descr || node.attrs.name)}"${w}${h}${style}>`
    }
    case 'rawRun':
      return ''
  }
}

function inlineStyleOf(marks: Mark[] | undefined): string {
  const list = (marks ?? []) as { type: string; attrs?: unknown }[]
  const runProps = list.find((m) => m.type === 'textStyle')?.attrs as RunProps | undefined
  const parts: string[] = []
  const base = runPropsToStyle({ ...DEFAULT_RUN_PROPS, ...(runProps ?? {}) })
  if (base) parts.push(base)
  if (list.some((m) => m.type === 'bold')) parts.push('font-weight:bold')
  if (list.some((m) => m.type === 'italic')) parts.push('font-style:italic')

  const underline = list.find((m) => m.type === 'underline')
  const strike = list.some((m) => m.type === 'strike' || m.type === 'doubleStrike')
  const decorations: string[] = []
  if (underline) decorations.push('underline')
  if (strike) decorations.push('line-through')
  if (decorations.length) parts.push(`text-decoration:${decorations.join(' ')}`)

  // 削除された文字は取り消し線で示す (変更履歴の表示)
  if (list.some((m) => m.type === 'deletion')) parts.push('text-decoration:line-through')

  return parts.join(';')
}

/**
 * 行頭記号の位置。ぶら下げインデントのぶんだけ左へ出す。
 * 画面側の markerStyle と同じ考え方。
 */
function markerStyle(marker: ListMarker): string {
  const ind = marker.level.pPr?.ind ?? null
  if (!ind) return ''
  const hanging =
    ind.hangingChars != null
      ? `${ind.hangingChars / 100}em`
      : ind.hanging != null
        ? `${round(twipToPt(ind.hanging))}pt`
        : null
  if (!hanging) return ''
  return ` style="display:inline-block;width:${hanging};margin-inline-start:-${hanging}"`
}

/** 見出しスタイルは見出しタグで出す。スタイル CSS が data-style で当たる */
function headingTagOf(pStyle: string | null): string {
  const m = /^Heading([1-6])$/.exec(pStyle ?? '')
  return m ? `h${m[1]}` : 'p'
}

function pt(twip: number): string {
  return `${round(twipToPt(twip))}pt`
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}

function escapeAttr(value: string): string {
  return escapeXml(value)
}

/** CSS の識別子として安全な名前にする (@page の名前に使う) */
function cssIdent(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_')
  return /^[A-Za-z_]/.test(safe) ? safe : `s_${safe}`
}
