import type { Editor } from '@tiptap/react'
import type { TableNode, TableCellNode, TableRowNode } from '@core/model/types'
import { ptToTwip } from '@shared/units'

/**
 * 表の挿入と編集。
 *
 * prosemirror-tables のコマンドをそのまま使えるが、
 * 挿入だけは Word 相当の属性 (tblGrid / 罫線) を持たせる必要があるので自前で組む。
 */

/** Word の既定に近い細い黒罫線 */
function defaultBorders(): NonNullable<TableNode['attrs']['borders']> {
  const side = { val: 'single', sz: 4, space: 0, color: '000000' }
  return {
    top: side,
    bottom: side,
    left: side,
    right: side,
    insideH: side,
    insideV: side
  }
}

function emptyCell(width: number): TableCellNode {
  return {
    type: 'tableCell',
    attrs: {
      colspan: 1,
      rowspan: 1,
      tcW: { value: width, type: 'dxa' },
      vAlign: 'top',
      borders: null,
      shd: null,
      rawTcPr: null
    },
    content: []
  }
}

/**
 * 表を挿入する。
 *
 * 列幅は本文の幅を等分する。tblGrid を持たせないと、
 * 保存したファイルを Word が開いたときに列幅が決まらない。
 */
export function insertTable(
  editor: Editor,
  rows: number,
  cols: number,
  textWidthTwip: number
): void {
  const width = Math.floor(textWidthTwip / Math.max(1, cols))
  const grid = Array.from({ length: cols }, () => width)

  const body: TableRowNode[] = Array.from({ length: rows }, (_, r) => ({
    type: 'tableRow',
    attrs: {
      // 1 行目は見出し行にする。ページを跨ぐときに繰り返される
      isHeader: r === 0,
      height: null,
      heightRule: null,
      cantSplit: false,
      rawTrPr: null
    },
    content: Array.from({ length: cols }, () => emptyCell(width))
  }))

  const table: TableNode = {
    type: 'table',
    attrs: {
      tblStyle: null,
      tblW: { value: 0, type: 'auto' },
      jc: null,
      grid,
      borders: defaultBorders(),
      cellMar: null,
      layout: 'autofit',
      rawTblPr: null
    },
    content: body
  }

  // セルの中身は空段落。Word のセルは必ず 1 つ以上の段落を含む
  const json = {
    type: 'table',
    attrs: table.attrs,
    content: body.map((row) => ({
      type: 'tableRow',
      attrs: row.attrs,
      content: row.content.map((cell) => ({
        type: 'tableCell',
        attrs: cell.attrs,
        content: [{ type: 'paragraph' }]
      }))
    }))
  }

  editor.chain().focus().insertContent(json).run()
}

/** prosemirror-tables のコマンド群。エディタの中に表がある場合だけ効く */
export interface TableCommands {
  addRowBefore: () => void
  addRowAfter: () => void
  deleteRow: () => void
  addColumnBefore: () => void
  addColumnAfter: () => void
  deleteColumn: () => void
  mergeCells: () => void
  splitCell: () => void
  toggleHeaderRow: () => void
  deleteTable: () => void
}

type ChainCommands = Record<string, () => { run: () => boolean }>

export function tableCommands(editor: Editor): TableCommands {
  const run = (name: string) => (): void => {
    const chain = editor.chain().focus() as unknown as ChainCommands
    chain[name]?.().run()
  }
  return {
    addRowBefore: run('addRowBefore'),
    addRowAfter: run('addRowAfter'),
    deleteRow: run('deleteRow'),
    addColumnBefore: run('addColumnBefore'),
    addColumnAfter: run('addColumnAfter'),
    deleteColumn: run('deleteColumn'),
    mergeCells: run('mergeCells'),
    splitCell: run('splitCell'),
    toggleHeaderRow: run('toggleHeaderRow'),
    deleteTable: run('deleteTable')
  }
}

/** 本文の幅 (twip)。列幅の等分に使う */
export function textWidthOf(pgSzW: number, marLeft: number, marRight: number): number {
  return Math.max(ptToTwip(72), pgSzW - marLeft - marRight)
}
