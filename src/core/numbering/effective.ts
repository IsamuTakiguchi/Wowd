import type { NumberingTable, StyleTable } from '../model/types'
import { resolveStyleChain } from '../docx/read/styles'

export type NumPr = { numId: number; ilvl: number }

/**
 * 段落の実効 numPr を求める。
 *
 * Word の番号は段落に直接書かれるとは限らない。見出しスタイルに番号を結び付けると、
 * 段落には w:pStyle だけが入り、numPr はスタイル側 (basedOn の先を含む) に入る。
 * 直接の numPr しか見ないと、こうした文書の番号が画面にも PDF にも出ない。
 *
 * 解決順:
 *   1. 段落に直接 numPr があればそれ。numId=0 は「番号を外す」という明示の指定
 *   2. スタイルの basedOn 連鎖を、近い方から numPr を探す
 *   3. スタイル側の numPr のレベルは、番号定義のうち w:pStyle が
 *      そのスタイルと一致するレベルを優先する (スタイル側の numPr は ilvl を省くのが普通)
 */
export function effectiveNumPr(
  paragraph: { numPr: NumPr | null; pStyle?: string | null },
  styles: StyleTable | null,
  table: NumberingTable | null
): NumPr | null {
  if (paragraph.numPr) return paragraph.numPr.numId === 0 ? null : paragraph.numPr
  if (!styles || !paragraph.pStyle) return null

  const chain = resolveStyleChain(styles, paragraph.pStyle)
  for (let i = chain.length - 1; i >= 0; i--) {
    const numPr = chain[i]?.pPr?.numPr
    if (!numPr) continue
    if (numPr.numId === 0) return null
    const linked = linkedLevel(table, numPr.numId, paragraph.pStyle)
    return { numId: numPr.numId, ilvl: linked ?? numPr.ilvl }
  }
  return null
}

/** numId の番号定義で、w:pStyle が styleId のレベル。無ければ null */
function linkedLevel(table: NumberingTable | null, numId: number, styleId: string): number | null {
  const instance = table?.instances.get(numId)
  if (!instance) return null
  for (const [ilvl, override] of instance.overrides) {
    if (override.level?.pStyle === styleId) return ilvl
  }
  const abstract = table?.abstract.get(instance.abstractNumId)
  if (!abstract) return null
  for (const [ilvl, level] of abstract.levels) {
    if (level.pStyle === styleId) return ilvl
  }
  return null
}
