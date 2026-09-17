/**
 * リストの行頭記号を求める。
 *
 * 画面 (Decoration) と印刷用 HTML の両方から使う。
 * ここを共有しないと「画面には (1) が出るのに PDF には出ない」といった
 * 食い違いが起きる。実際に一度そうなった。
 */
import type { NumberingTable, NumberingLevel } from '../model/types'
import { resolveLevel } from './resolve'
import { renderLevelText } from './format'

export interface NumberedParagraph {
  numPr: { numId: number; ilvl: number } | null
}

export interface ListMarker {
  /** 表示する記号。空文字なら記号を出さない */
  text: string
  /** 記号のあとに入れる区切り */
  suffix: string
  level: NumberingLevel
}

/**
 * 段落の並びを順に走査して、各段落の行頭記号を決める。
 *
 * カウンタは numId ごとに保持し、浅いレベルに戻ったら
 * それより深いレベルをリセットする。この規則を守らないと
 * 実際の Word 文書に頻出する非単調な ilvl の並びで番号が狂う。
 *
 * @returns 段落の添字 → 記号。リストでない段落は含まれない
 */
export function computeListMarkers(
  paragraphs: NumberedParagraph[],
  table: NumberingTable | null
): Map<number, ListMarker> {
  const out = new Map<number, ListMarker>()
  if (!table || table.instances.size === 0) return out

  const counters = new Map<number, number[]>()
  const lastLevel = new Map<number, number>()

  paragraphs.forEach((paragraph, index) => {
    const numPr = paragraph.numPr
    if (!numPr) return

    const { numId, ilvl } = numPr
    const level = resolveLevel(table, numId, ilvl)
    if (!level) return

    let counter = counters.get(numId)
    if (!counter) {
      counter = new Array<number>(9).fill(0)
      counters.set(numId, counter)
    }

    const previous = lastLevel.get(numId)
    if (previous != null && ilvl < previous) {
      for (let i = ilvl + 1; i < counter.length; i++) counter[i] = 0
    }
    // このレベルが初出ならレベル定義の start から始める
    if (counter[ilvl] === 0) counter[ilvl] = level.start - 1

    counter[ilvl] = (counter[ilvl] ?? 0) + 1
    lastLevel.set(numId, ilvl)

    const text = markerText(table, numId, level, counter)
    if (text === '') return

    out.set(index, {
      text,
      suffix: level.suff === 'tab' ? '	' : level.suff === 'space' ? ' ' : '',
      level
    })
  })

  return out
}

function markerText(
  table: NumberingTable,
  numId: number,
  level: NumberingLevel,
  counter: number[]
): string {
  if (level.numFmt === 'none') return ''
  if (level.numFmt === 'bullet') return level.lvlText

  // %1〜%9 は各レベルの numFmt で整形する必要があるので全レベルの書式を集める
  const formats: string[] = []
  for (let i = 0; i < 9; i++) {
    formats.push(resolveLevel(table, numId, i)?.numFmt ?? 'decimal')
  }
  return renderLevelText(level.lvlText, counter, formats)
}
