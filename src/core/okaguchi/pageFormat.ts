/**
 * 岡口マクロの「書式変更」(Alt+P) を移植したもの。文書を裁判所書式にする。
 *
 * A4 縦、余白 上 35・下 25・左 30・右 20 mm、1 行 37 字 × 1 ページ 26 行、12pt、
 * フッターにページ番号 (中央)。行番号 (5 行ごと・ページごとに振り直し) は任意。
 *
 * 出典: 岡口マクロ_書式変更.frm (CommandButton1_Click)、岡口マクロ_ベース 61–190 行。
 */
import type { RunProps, SectionProps, StyleDef, StyleTable } from '../model/types'
import { docGridFor } from '../layout/grid'
import { mmToTwip } from '../../shared/units'

export const LATIN_FONTS = ['Times New Roman', 'ＭＳ 明朝', 'Century'] as const
export type LatinFont = (typeof LATIN_FONTS)[number]

export const COURT_FORMAT = {
  /** 本文の文字の大きさ (半ポイント)。12pt */
  sizeHalfPt: 24,
  charsPerLine: 37,
  linesPerPage: 26,
  eastAsiaFont: 'ＭＳ 明朝',
  marginsMm: { top: 35, bottom: 25, left: 30, right: 20, header: 0, footer: 15, gutter: 0 },
  /** A4 (twip) */
  pageTwip: { w: 11906, h: 16838 }
} as const

function emptyRunProps(): RunProps {
  return {
    rFonts: null,
    sz: null,
    szCs: null,
    color: null,
    highlight: null,
    shd: null,
    spacing: null,
    w: null,
    kern: null,
    vertAlign: null,
    rStyle: null,
    lang: null,
    rawRPr: null
  }
}

/**
 * 標準スタイルのフォントを裁判所書式にする。
 *
 * 日本語は ＭＳ 明朝、英数字は選んだフォント、12pt。太字・斜体・下線・字間・横幅などは
 * 元のマクロと同じくすべて解除する (標準スタイルの文字書式を組み立て直すので、
 * モデルに無い項目も含めて消える)。カーニングは 1pt 以上。
 * 段落書式 (pPr) は触らない。
 *
 * 行番号の文字 (スタイル「行番号」) は 7pt。
 */
export function courtStyles(styles: StyleTable, latin: LatinFont): StyleTable {
  const out: StyleTable = { ...styles, byId: new Map(styles.byId) }
  const normalId = styles.defaults.paragraph ?? 'Normal'
  const normal = styles.byId.get(normalId)

  const rPr: RunProps = {
    ...emptyRunProps(),
    rFonts: { ascii: latin, hAnsi: latin, cs: latin, eastAsia: COURT_FORMAT.eastAsiaFont },
    sz: COURT_FORMAT.sizeHalfPt,
    szCs: COURT_FORMAT.sizeHalfPt,
    // Kerning = 1 (pt)。w:kern は半ポイント
    kern: 2
  }

  const base: StyleDef = normal ?? {
    styleId: normalId,
    type: 'paragraph',
    name: 'Normal',
    basedOn: null,
    next: null,
    linkedStyle: null,
    isDefault: true,
    quickFormat: true,
    uiPriority: 0,
    semiHidden: false,
    pPr: null,
    rPr: null,
    rawXml: ''
  }
  out.byId.set(normalId, { ...base, rPr, rawXml: '' })
  if (!styles.defaults.paragraph) out.defaults = { ...styles.defaults, paragraph: normalId }

  const lineNumberId = findLineNumberStyle(styles) ?? 'LineNumber'
  const lineNumber = styles.byId.get(lineNumberId)
  out.byId.set(lineNumberId, {
    styleId: lineNumberId,
    type: 'character',
    name: 'line number',
    basedOn: lineNumber?.basedOn ?? null,
    next: null,
    linkedStyle: null,
    isDefault: false,
    quickFormat: false,
    uiPriority: lineNumber?.uiPriority ?? 99,
    semiHidden: true,
    pPr: null,
    rPr: { ...(lineNumber?.rPr ?? emptyRunProps()), sz: 14, szCs: 14 },
    rawXml: ''
  })
  return out
}

function findLineNumberStyle(styles: StyleTable): string | null {
  for (const s of styles.byId.values()) {
    if (s.type === 'character' && s.name.toLowerCase() === 'line number') return s.styleId
  }
  return null
}

/**
 * セクションを裁判所書式にする。
 *
 * 文字数と行数のグリッドは、新しい余白と 12pt から求め直す
 * (余白を先に変えないと、本文の幅が変わってグリッドの字数がずれる)。
 */
export function courtSection(section: SectionProps, lineNumbers: boolean): SectionProps {
  const m = COURT_FORMAT.marginsMm
  const next: SectionProps = {
    ...section,
    pgSz: {
      w: COURT_FORMAT.pageTwip.w,
      h: COURT_FORMAT.pageTwip.h,
      // 縦は既定なので、元に属性が無ければ足さない
      orient: section.pgSz.orient === 'landscape' ? 'portrait' : section.pgSz.orient
    },
    pgMar: {
      top: mmToTwip(m.top),
      bottom: mmToTwip(m.bottom),
      left: mmToTwip(m.left),
      right: mmToTwip(m.right),
      header: mmToTwip(m.header),
      footer: mmToTwip(m.footer),
      gutter: mmToTwip(m.gutter)
    },
    // 先頭ページ別のヘッダーは使わない
    titlePg: false,
    // 縦方向の配置 (w:vAlign) は上が既定なので、指定があれば外す
    rawSectPr: withLineNumbers(stripRaw(section.rawSectPr, ['w:vAlign']), lineNumbers)
  }
  next.docGrid = docGridFor(next, COURT_FORMAT.sizeHalfPt, COURT_FORMAT.charsPerLine, COURT_FORMAT.linesPerPage)
  return next
}

/** 生の sectPr 断片から、指定した要素を取り除く */
function stripRaw(raw: string | null, tags: string[]): string | null {
  if (!raw) return raw
  let out = raw
  for (const tag of tags) {
    const t = tag.replace(':', '\\:')
    out = out.replace(new RegExp(`<${t}\\b[^>]*/>`, 'g'), '')
    out = out.replace(new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?</${t}>`, 'g'), '')
  }
  return out.length > 0 ? out : null
}

/** 行番号 (w:lnNumType)。1 から、5 行ごとに表示、ページごとに振り直し */
function withLineNumbers(raw: string | null, on: boolean): string | null {
  const without = stripRaw(raw, ['w:lnNumType'])
  if (!on) return without
  return (without ?? '') + '<w:lnNumType w:countBy="5" w:restart="newPage"/>'
}
