/**
 * 岡口マクロの「連番ランク」を移植したもの。
 *
 * 元のマクロ (VBA) は実行しない。動作を読み取って、Word と互換のある形
 * (スタイル + スタイルに結び付けた番号定義) で同じ結果を作る。
 * そのため Wowd で作った文書を Word で開いても、同じ番号が出る。
 *
 * - 連番ランク設定 (Alt+R): スタイル「本文０〜８」「ランク１〜８」と、
 *   ランクに結び付けた 8 段の番号 (第１ / １ / ⑴ / ア / (ア) / a / (a) / ①) を作る
 * - ランクN (Alt+N): 段落をランクN ⇔ 本文N で切り替える (段落の操作は renderer 側)
 * - 打直 (Alt+Shift+N): ランクN にして番号を 1 から振り直す
 * - 連番ランク修正 (Alt+Shift+R): ランク１・２で 10 以上になった番号を半角にする
 *
 * 仕様の出典は岡口マクロ_ベース (連番ランク設定 1589–2148 行など)。
 */
import type {
  NumberingLevel,
  NumberingTable,
  ParagraphAttrs,
  RunProps,
  SectionProps,
  StyleDef,
  StyleTable
} from '../model/types'
import { effectiveRunProps } from '../docx/read/styles'
import { gridFromSection, normalSizeOf } from '../layout/grid'
import { pageGeometry } from '../layout/pageGeometry'
import { nextAbstractNumId, nextNumId } from '../numbering/resolve'
import { computeListMarkers } from '../numbering/markers'
import { twipToPt } from '../../shared/units'

export const RANK_COUNT = 8

const FULL_DIGITS = '０１２３４５６７８９'

/** 1 桁の数字を全角にする。スタイル名の数字はすべて全角 */
function fullDigit(n: number): string {
  return String(n)
    .split('')
    .map((d) => FULL_DIGITS[Number(d)] ?? d)
    .join('')
}

export function rankStyleName(n: number): string {
  return `ランク${fullDigit(n)}`
}

export function bodyStyleName(n: number): string {
  return `本文${fullDigit(n)}`
}

/** Wowd が新しく作るときのスタイル ID。名前 (日本語) で探すので、ID は ASCII にしておく */
const RANK_ID_PREFIX = 'OkaguchiRank'
const BODY_ID_PREFIX = 'OkaguchiBody'

export interface RankStyleIds {
  /** 添字 1..8。0 は使わない */
  rank: string[]
  /** 添字 0..8 */
  body: string[]
}

/** ランクごとの番号の形 (仕様 §1.6) */
const RANK_FORMATS: { lvlText: string; numFmt: string; w: number | null }[] = [
  { lvlText: '第%1', numFmt: 'decimalFullWidth', w: null },
  { lvlText: '%2', numFmt: 'decimalFullWidth', w: null },
  { lvlText: '%3', numFmt: 'decimalEnclosedParen', w: null },
  { lvlText: '%4', numFmt: 'aiueoFullWidth', w: null },
  // 半角の丸括弧 + 全角カナ = 全角 2 字分。50% にして全角 1 字分に収める
  { lvlText: '(%5)', numFmt: 'aiueoFullWidth', w: 50 },
  { lvlText: '%6', numFmt: 'lowerLetter', w: null },
  // 半角 3 字 = 全角 1.5 字分。66% で全角 1 字分
  { lvlText: '(%7)', numFmt: 'lowerLetter', w: 66 },
  { lvlText: '%8', numFmt: 'decimalEnclosedCircle', w: null }
]

/** ランク N の番号の右端 (字数)。ランク１は「第１」が 2 字なので 2 */
export function rankNumberEnd(n: number): number {
  return Math.max(2, n)
}

/** 名前でスタイルを探す。Word で岡口マクロを使って作った文書も、名前で見つかる */
function findByName(styles: StyleTable, name: string): StyleDef | undefined {
  for (const style of styles.byId.values()) {
    if (style.type === 'paragraph' && style.name === name) return style
  }
  return undefined
}

/** 設定済みならスタイル ID を返す。1 つでも欠けていれば null */
export function findRankStyleIds(styles: StyleTable): RankStyleIds | null {
  const rank: string[] = ['']
  const body: string[] = []
  for (let n = 0; n <= RANK_COUNT; n++) {
    const b = findByName(styles, bodyStyleName(n))
    if (!b) return null
    body.push(b.styleId)
    if (n === 0) continue
    const r = findByName(styles, rankStyleName(n))
    if (!r) return null
    rank.push(r.styleId)
  }
  return { rank, body }
}

/** ランクのスタイルが指す numId (番号の系列の基準)。無ければ null */
export function rankBaseNumId(styles: StyleTable, ids: RankStyleIds, table: NumberingTable): number | null {
  const numId = styles.byId.get(ids.rank[1] ?? '')?.pPr?.numPr?.numId
  if (numId == null || !table.instances.has(numId)) return null
  return numId
}

/** スタイル ID → ランク (1..8)。ランクでなければ null */
export function rankOfStyle(ids: RankStyleIds, styleId: string | null): number | null {
  if (!styleId) return null
  const i = ids.rank.indexOf(styleId)
  return i >= 1 ? i : null
}

/** 1 字の幅 (twip)。文字グリッドがあればその送り、無ければ標準の文字の大きさ */
export function charPitchTwip(section: SectionProps | undefined, normalSizeHalfPt: number): number {
  const sizePt = normalSizeHalfPt / 2
  if (!section) return Math.round(sizePt * 20)
  const grid = gridFromSection(section, normalSizeOf(normalSizeHalfPt))
  if (grid?.charGridEnabled && grid.charsPerLine > 0) {
    return Math.round((twipToPt(pageGeometry(section).textInline) / grid.charsPerLine) * 20)
  }
  return Math.round(sizePt * 20)
}

export interface RankSetup {
  styles: StyleTable
  ids: RankStyleIds
  numId: number
  /** 番号定義を新しく作ったか (numbering.xml を書き直す印に使う) */
  numberingCreated: boolean
}

/**
 * 連番ランク設定 (Alt+R)。
 *
 * スタイル表は新しいオブジェクトを返す (画面のスタイル CSS を作り直させるため)。
 * 番号定義は numbering に**その場で**足す (ほかのリスト操作と同じ扱い)。
 *
 * 何度実行してもよい。既にあるスタイルと番号定義は上書きで更新する
 * (元のマクロも、標準フォントや文字数を変えたら再設定するよう案内している)。
 */
export function setupRanks(
  styles: StyleTable,
  numbering: NumberingTable,
  section: SectionProps | undefined
): RankSetup {
  const normal = effectiveRunProps(styles, styles.defaults.paragraph)
  const normalSize = normal.sz ?? styles.docDefaults.rPr?.sz ?? 21
  const pitch = charPitchTwip(section, normalSize)

  // 元のマクロは標準スタイルのフォントと大きさを各スタイルに写す
  const font: RunProps = {
    rFonts: normal.rFonts ?? null,
    sz: normal.sz ?? null,
    szCs: normal.szCs ?? null,
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

  const out: StyleTable = { ...styles, byId: new Map(styles.byId) }
  const takenIds = new Set(out.byId.keys())
  const idFor = (name: string, prefix: string, n: number): string => {
    const existing = findByName(out, name)
    if (existing) return existing.styleId
    let id = `${prefix}${n}`
    for (let i = 2; takenIds.has(id); i++) id = `${prefix}${n}_${i}`
    takenIds.add(id)
    return id
  }

  const ids: RankStyleIds = { rank: [''], body: [] }
  for (let n = 0; n <= RANK_COUNT; n++) ids.body.push(idFor(bodyStyleName(n), BODY_ID_PREFIX, n))
  for (let n = 1; n <= RANK_COUNT; n++) ids.rank.push(idFor(rankStyleName(n), RANK_ID_PREFIX, n))

  // ---- 番号定義 ----
  const existingNumId = rankBaseNumId(styles, ids, numbering)
  let numId: number
  let abstractNumId: number
  let numberingCreated = false
  if (existingNumId != null) {
    numId = existingNumId
    abstractNumId = numbering.instances.get(numId)!.abstractNumId
  } else {
    abstractNumId = nextAbstractNumId(numbering)
    numId = nextNumId(numbering)
    numbering.instances.set(numId, { numId, abstractNumId, overrides: new Map(), rawXml: '' })
    numberingCreated = true
  }
  const levels = new Map<number, NumberingLevel>()
  for (let ilvl = 0; ilvl < 9; ilvl++) {
    const n = ilvl + 1
    const format = RANK_FORMATS[ilvl]
    const position = pitch * rankNumberEnd(Math.min(n, 9))
    levels.set(ilvl, {
      ilvl,
      start: 1,
      numFmt: format?.numFmt ?? 'none',
      lvlText: format?.lvlText ?? '',
      // 番号は右揃え。番号の右端を本文の開始位置にそろえる
      lvlJc: 'right',
      lvlRestart: null,
      suff: 'nothing',
      pPr: { ind: { left: position, hanging: 0 } },
      rPr: format?.w != null ? { ...font, rFonts: null, sz: null, szCs: null, w: format.w } : null,
      rFonts: null,
      isLgl: false,
      pStyle: n <= RANK_COUNT ? ids.rank[n] : null
    })
  }
  const previous = numbering.abstract.get(abstractNumId)
  numbering.abstract.set(abstractNumId, {
    abstractNumId,
    nsid: previous?.nsid ?? null,
    multiLevelType: 'multilevel',
    levels,
    // 組み立て直す。原文 (rawXml) を残すと、更新した値が保存されない
    rawXml: ''
  })
  if (existingNumId != null) numberingCreated = true

  // ---- スタイル ----
  const common = (extra: Partial<ParagraphAttrs>): Partial<ParagraphAttrs> => ({
    jc: 'both',
    // 元のマクロは WidowControl = False (改ページ時の 1 行残しをしない)
    rawPPr: '<w:widowControl w:val="0"/>',
    ...extra
  })
  const define = (
    id: string,
    name: string,
    pPr: Partial<ParagraphAttrs>,
    extra: Partial<StyleDef> = {}
  ): void => {
    out.byId.set(id, {
      styleId: id,
      type: 'paragraph',
      name,
      basedOn: null,
      next: null,
      linkedStyle: null,
      isDefault: false,
      quickFormat: true,
      uiPriority: 99,
      semiHidden: false,
      custom: true,
      pPr,
      rPr: { ...font },
      rawXml: '',
      ...extra
    })
  }

  for (let n = 0; n <= RANK_COUNT; n++) {
    // 本文１と本文２は同じ値 (左 2 字・字下げ 1 字)。本文０は字下げなし
    const left = n === 0 ? 0 : Math.max(2, n)
    const firstLine = n === 0 ? 0 : 1
    define(
      ids.body[n]!,
      bodyStyleName(n),
      common({ ind: { leftChars: left * 100, firstLineChars: firstLine * 100, left: left * pitch, firstLine: firstLine * pitch } }),
      { basedOn: styles.defaults.paragraph ?? null }
    )
  }
  for (let n = 1; n <= RANK_COUNT; n++) {
    const left = rankNumberEnd(n)
    define(
      ids.rank[n]!,
      rankStyleName(n),
      common({
        ind: { leftChars: left * 100, firstLineChars: 0, left: left * pitch, firstLine: 0 },
        outlineLvl: n - 1,
        numPr: { numId, ilvl: n - 1 }
      }),
      // 元のマクロは BaseStyle = "" (基準なし)。次の段落は本文N
      { next: ids.body[n]! }
    )
  }

  return { styles: out, ids, numId, numberingCreated }
}

/**
 * 打直 (Alt+Shift+N) のための num を作る。
 *
 * 同じ番号定義を指す新しい w:num に、そのレベルの startOverride = 1 を付ける。
 * Word で「番号を振り直す」をしたときと同じ形なので、Word で開いても 1 から始まる。
 * この num を当てるのは振り直す段落だけでよい。同じ定義を指す num は番号を
 * 引き継ぐので、後続の段落はこの段落の続き番号になる。
 */
export function createRestartNum(numbering: NumberingTable, baseNumId: number, ilvl: number): number {
  const base = numbering.instances.get(baseNumId)
  if (!base) throw new Error(`numId ${baseNumId} がありません`)
  const numId = nextNumId(numbering)
  numbering.instances.set(numId, {
    numId,
    abstractNumId: base.abstractNumId,
    overrides: new Map([[ilvl, { startOverride: 1, level: null }]]),
    rawXml: ''
  })
  return numId
}

/** 段落の番号に関わる値だけ。連番ランク修正の入出力に使う */
export interface RankParagraph {
  numPr: { numId: number; ilvl: number } | null
  pStyle: string | null
}

/**
 * 連番ランク修正 (Alt+Shift+R) の計画を立てる。
 *
 * ランク１・２の番号を「1〜9 は全角、10 以上は半角」にする (第９ → 第10)。
 *
 * Word と互換のある形で表す: 10 以上が続く区間ごとに、半角 (decimal) のレベルを持つ
 * w:num を作り、その区間の段落に当てる。区間の先頭には startOverride = その値 を付ける。
 * 番号を値で明示するので、Word が上書き (lvlOverride) で数え直すかどうかに関わらず
 * 同じ番号になる。
 *
 * 何度実行してもよい。前回の修正で当てた num は外してから計算し直す
 * (段落を足したり消したりすると区間が変わるため)。
 *
 * @returns 段落の添字 → 新しい numPr (null は直接指定を外す)。変更の無い段落は含まない
 */
export function planHalfWidthFix(
  paragraphs: RankParagraph[],
  numbering: NumberingTable,
  styles: StyleTable,
  ids: RankStyleIds
): Map<number, RankParagraph['numPr']> {
  const changes = new Map<number, RankParagraph['numPr']>()
  const baseNumId = rankBaseNumId(styles, ids, numbering)
  if (baseNumId == null) return changes
  const abstractNumId = numbering.instances.get(baseNumId)!.abstractNumId

  // 前回の修正を外した状態で数え直す
  const stale = new Set<number>()
  const working = paragraphs.map((p, i) => {
    if (p.numPr && isHalfWidthNum(numbering, p.numPr.numId, abstractNumId)) {
      stale.add(p.numPr.numId)
      changes.set(i, null)
      return { ...p, numPr: null }
    }
    return p
  })
  const markers = computeListMarkers(working, numbering, styles)

  // レベルごとの、いま続いている「10 以上」の区間の numId
  const runs: (number | null)[] = [null, null]
  working.forEach((p, i) => {
    const rank = rankOfStyle(ids, p.pStyle)
    const marker = markers.get(i)
    // ランク１の段落はランク２の区間を切る (ランク２は 1 に戻るので)
    if (rank === 1) runs[1] = null
    if (rank == null || rank > 2 || !marker) return
    const ilvl = rank - 1
    if (marker.value < 10) {
      runs[ilvl] = null
      return
    }
    let numId = runs[ilvl]
    if (numId == null) {
      numId = nextNumId(numbering)
      const level = { ...marker.level, numFmt: 'decimal' }
      numbering.instances.set(numId, {
        numId,
        abstractNumId,
        overrides: new Map([[ilvl, { startOverride: marker.value, level }]]),
        rawXml: ''
      })
      runs[ilvl] = numId
    }
    changes.set(i, { numId, ilvl })
  })

  // 前回の修正で作った num は、もうどの段落も指していなければ消す
  for (const numId of stale) numbering.instances.delete(numId)

  return changes
}

/** 連番ランク修正が作った num か (上書きレベルが半角の decimal) */
function isHalfWidthNum(numbering: NumberingTable, numId: number, abstractNumId: number): boolean {
  const instance = numbering.instances.get(numId)
  if (!instance || instance.abstractNumId !== abstractNumId) return false
  for (const [ilvl, o] of instance.overrides) {
    if (ilvl <= 1 && o.level?.numFmt === 'decimal') return true
  }
  return false
}
