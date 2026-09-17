import type { TableNode, TableRowNode, TableCellNode } from '@core/model/types'

/**
 * OOXML と ProseMirror で表のモデルが違うので、その間を変換する。
 *
 * OOXML: 縦結合は「開始セル (w:vMerge restart)」と
 *        「継続セル (w:vMerge)」が各行に明示的に置かれる
 * ProseMirror: 縦結合は開始セルの rowspan だけで表し、
 *        覆われた行にセルは置かない
 *
 * 継続セルを残したまま ProseMirror に渡すと、行の列数が合わないと判断されて
 * prosemirror-tables が勝手にセルを足す。開いて保存しただけで
 * 表の構造が変わってしまうので、ここで確実に落として確実に戻す。
 */

/** WowdDoc の表 → ProseMirror 向け。縦結合の継続セルを取り除く */
export function stripMergeContinuations(table: TableNode): TableRowNode[] {
  return table.content.map((row) => ({
    ...row,
    content: row.content.filter((cell) => cell.attrs.rowspan !== 0)
  }))
}

/** 行の総列数。tblGrid が無い文書もあるので最初の行から数えて補う */
function gridWidthOf(table: { grid: number[] }, rows: TableRowNode[]): number {
  if (table.grid.length > 0) return table.grid.length
  let max = 0
  for (const row of rows) {
    let width = 0
    for (const cell of row.content) width += Math.max(1, cell.attrs.colspan)
    max = Math.max(max, width)
  }
  return max
}

interface ActiveSpan {
  col: number
  colspan: number
  /** あと何行ぶん覆うか */
  remaining: number
  source: TableCellNode
}

/**
 * ProseMirror の表 → WowdDoc。縦結合の継続セルを復元する。
 *
 * 格子を左から走査して、上の行から伸びている結合が占める位置に
 * 継続セルを挿し直す。
 */
export function restoreMergeContinuations(
  rows: TableRowNode[],
  grid: number[]
): TableRowNode[] {
  const width = gridWidthOf({ grid }, rows)
  if (width === 0) return rows

  const active: ActiveSpan[] = []
  const out: TableRowNode[] = []

  for (const row of rows) {
    const cells: TableCellNode[] = []
    let col = 0
    let index = 0

    while (col < width) {
      const span = active.find((s) => s.col === col && s.remaining > 0)
      if (span) {
        cells.push(continuationOf(span.source, span.colspan))
        span.remaining -= 1
        col += span.colspan
        continue
      }

      const cell = row.content[index]
      if (!cell) break
      index += 1

      const colspan = Math.max(1, cell.attrs.colspan)
      cells.push(cell)
      if (cell.attrs.rowspan > 1) {
        active.push({ col, colspan, remaining: cell.attrs.rowspan - 1, source: cell })
      }
      col += colspan
    }

    // 格子より多くセルがある行はそのまま残す。落とすより残す方が安全
    for (; index < row.content.length; index++) {
      const extra = row.content[index]
      if (extra) cells.push(extra)
    }

    out.push({ ...row, content: cells })
  }

  return out
}

/** 縦結合の継続セル。書式は開始セルから引き継ぐ */
function continuationOf(source: TableCellNode, colspan: number): TableCellNode {
  return {
    type: 'tableCell',
    attrs: {
      colspan,
      rowspan: 0,
      tcW: source.attrs.tcW,
      vAlign: source.attrs.vAlign,
      borders: source.attrs.borders,
      shd: source.attrs.shd,
      rawTcPr: null
    },
    content: [
      {
        type: 'paragraph',
        attrs: {
          pStyle: null,
          numPr: null,
          jc: null,
          spacing: null,
          ind: null,
          outlineLvl: null,
          keepNext: false,
          keepLines: false,
          pageBreakBefore: false,
          snapToGrid: true,
          sectionId: null,
          paraId: null,
          markRunProps: null,
          rawPPr: null,
          pPrChange: null
        }
      }
    ]
  }
}
