import type { Mark, ParagraphAttrs, RevisionMeta, SectionProps } from '../model/types'
import { collectMarks, writeRunProps } from '../docx/write/run'
import { writeParagraphProps } from '../docx/write/paragraph'
import { marksFrom, readRunProps } from '../docx/read/run'
import { readParagraphProps } from '../docx/read/paragraph'
import { parseXml, tagOf } from '../docx/xml'

/**
 * 書式の変更履歴 (w:rPrChange / w:pPrChange) を組み立てる。
 *
 * 挿入と削除は w:ins / w:del で表されるが、**書式だけを変えた履歴**は
 * 別の形を取る。「変更後の書式」をそのまま持ち、
 * 「変更前の書式」を w:rPrChange / w:pPrChange の子として抱える。
 *
 * この 2 つは読み取りと往復には対応していたが、**作る側が無かった**。
 * 記録中に書式を変えても履歴に残らず、黙って書式だけが変わっていた。
 *
 * モデルには持たず、rawRPr / rawPPr に原文として入れる。
 * 書き出しの順序表が w:rPrChange / w:pPrChange を正しい位置に置くので、
 * 規格どおりの並びになる。
 *
 * ## 上書きしない
 *
 * すでに変更履歴が付いている箇所の書式をもう一度変えても、
 * **最初の「変更前」を保つ**。w:rPrChange が指すのは
 * 「記録を始める前の姿」であって「1 つ前の姿」ではない。
 * 上書きすると、取り消したときに元へ戻らなくなる。
 */

/** w:rPrChange の全体を取り出す正規表現。属性は任意 */
const R_PR_CHANGE = /<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/
const P_PR_CHANGE = /<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/

/** 変更履歴が付いているか */
export function hasRunFormatChange(rawRPr: string | null): boolean {
  return rawRPr != null && R_PR_CHANGE.test(rawRPr)
}

export function hasParaFormatChange(rawPPr: string | null): boolean {
  return rawPPr != null && P_PR_CHANGE.test(rawPPr)
}

/** 変更履歴を取り除く。承諾したとき (変更後の書式をそのまま残す) に使う */
export function stripRunFormatChange(rawRPr: string | null): string | null {
  if (rawRPr == null) return null
  const out = rawRPr.replace(R_PR_CHANGE, '')
  return out.length > 0 ? out : null
}

export function stripParaFormatChange(rawPPr: string | null): string | null {
  if (rawPPr == null) return null
  const out = rawPPr.replace(P_PR_CHANGE, '')
  return out.length > 0 ? out : null
}

/** 変更前の書式 (w:rPrChange の中の w:rPr の中身) を返す。取り消しに使う */
export function previousRunProps(rawRPr: string | null): string | null {
  if (rawRPr == null) return null
  const change = R_PR_CHANGE.exec(rawRPr)?.[0]
  if (!change) return null
  return /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(change)?.[1] ?? ''
}

export function previousParaProps(rawPPr: string | null): string | null {
  if (rawPPr == null) return null
  const change = P_PR_CHANGE.exec(rawPPr)?.[0]
  if (!change) return null
  return /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(change)?.[1] ?? ''
}

function metaAttrs(meta: RevisionMeta): string {
  const author = meta.author.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;'
  )
  const date = meta.date ? ` w:date="${meta.date}"` : ''
  return `w:id="${String(meta.id)}" w:author="${author}"${date}`
}

/**
 * 変更前のランの書式から w:rPrChange を作り、rawRPr に足す。
 *
 * すでに付いていれば**そのまま返す** (最初の「変更前」を保つため)。
 */
export function withRunFormatChange(
  rawRPr: string | null,
  previousMarks: Mark[] | undefined,
  meta: RevisionMeta
): string | null {
  if (hasRunFormatChange(rawRPr)) return rawRPr

  const set = collectMarks(previousMarks)
  // 変更前の rawRPr には、前の変更履歴が入っていることがある。
  // それごと「変更前」に写すと入れ子になるので外す
  if (set.props) set.props = { ...set.props, rawRPr: stripRunFormatChange(set.props.rawRPr) }
  // CT_RPrOriginal は w:rPr と同じ子を取る。空でも要素は要る
  const inner = writeRunProps(set) || '<w:rPr></w:rPr>'
  const change = `<w:rPrChange ${metaAttrs(meta)}>${inner}</w:rPrChange>`
  return (stripRunFormatChange(rawRPr) ?? '') + change
}

/**
 * 変更前の段落書式から w:pPrChange を作り、rawPPr に足す。
 *
 * CT_PPrChange の子は CT_PPrBase なので、
 * **w:rPr・w:sectPr・w:pPrChange は入れられない。**入れると Word が拒む。
 */
export function withParaFormatChange(
  rawPPr: string | null,
  previous: ParagraphAttrs,
  sections: Map<string, SectionProps>,
  meta: RevisionMeta
): string | null {
  if (hasParaFormatChange(rawPPr)) return rawPPr

  const base: ParagraphAttrs = {
    ...previous,
    markRunProps: null,
    paraMarkRevision: null,
    sectionId: null,
    rawPPr: stripParaFormatChange(previous.rawPPr)
  }
  const inner = writeParagraphProps(base, sections) || '<w:pPr></w:pPr>'
  const change = `<w:pPrChange ${metaAttrs(meta)}>${inner}</w:pPrChange>`
  return (stripParaFormatChange(rawPPr) ?? '') + change
}

/**
 * 変更前の書式を読み戻す。取り消し (元に戻す) に使う。
 *
 * 作るときに書き出し側を使ったので、戻すときは読み取り側を使う。
 * 同じ経路を通るので、往復で食い違わない。
 */
export function restoredRunMarks(rawRPr: string | null): Mark[] | null {
  const inner = previousRunProps(rawRPr)
  if (inner == null) return null
  const node = parseXml(`<w:rPr>${inner}</w:rPr>`).find((n) => tagOf(n) === 'w:rPr')
  return marksFrom(readRunProps(node))
}

/** 変更前の段落書式を読み戻す。sectPr は CT_PPrBase に無いので出てこない */
export function restoredParaAttrs(rawPPr: string | null): Partial<ParagraphAttrs> | null {
  const inner = previousParaProps(rawPPr)
  if (inner == null) return null
  const node = parseXml(`<w:pPr>${inner}</w:pPr>`).find((n) => tagOf(n) === 'w:pPr')
  const { attrs } = readParagraphProps(node)
  // 段落記号の書式とセクションは変更履歴の対象外。呼び出し側の値を残す
  const { markRunProps: _m, sectionId: _s, paraMarkRevision: _r, ...rest } = attrs
  return rest
}
