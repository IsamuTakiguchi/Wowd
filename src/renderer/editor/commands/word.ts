/**
 * Word と同じ操作のうち、リボン・キー・右クリックから共通に呼ぶもの。
 *
 * - フォントサイズの拡大・縮小 (Ctrl+Shift+> / <、Ctrl+] / [)
 * - 段落書式の解除 (Ctrl+Q)
 * - 書式のコピー / 貼り付け (ブラシ。Ctrl+Shift+C / V)
 */
import type { Editor } from '@tiptap/react'
import type { Mark as PMMark } from '@tiptap/pm/model'
import type { ParagraphAttrs } from '@core/model/types'
import { currentRunProps, patchRunProps, currentBlockName } from './format'
import { recordParaFormatChange, recordRunFormatChange } from '../track/formatRevision'

/** Word のフォントサイズの一覧 (pt)。拡大・縮小はこの並びを 1 つずつ動く */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]

/**
 * 次 / 前の大きさ (pt)。一覧の外 (72 より上など) は 10pt ずつ。
 *
 * @param current いまの大きさ (pt)
 */
export function nextFontSize(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    const next = FONT_SIZES.find((s) => s > current + 0.01)
    return next ?? Math.floor(current / 10) * 10 + 10
  }
  const prev = [...FONT_SIZES].reverse().find((s) => s < current - 0.01)
  if (prev != null) return prev
  return Math.max(1, current - 1)
}

/**
 * フォントサイズを一覧の次 / 前へ (Ctrl+Shift+> / <)。
 *
 * @param fallbackHalfPt 文字に大きさの指定が無いときの大きさ (スタイル由来。半ポイント)
 */
export function growFont(editor: Editor, direction: 1 | -1, fallbackHalfPt: number): void {
  const current = (currentRunProps(editor)?.sz ?? fallbackHalfPt) / 2
  const pt = nextFontSize(current, direction)
  patchRunProps(editor, { sz: Math.round(pt * 2), szCs: Math.round(pt * 2) })
}

/** フォントサイズを 1pt 大きく / 小さく (Ctrl+] / [) */
export function stepFont(editor: Editor, deltaPt: number, fallbackHalfPt: number): void {
  const current = (currentRunProps(editor)?.sz ?? fallbackHalfPt) / 2
  const pt = Math.max(1, Math.min(1638, current + deltaPt))
  patchRunProps(editor, { sz: Math.round(pt * 2), szCs: Math.round(pt * 2) })
}

/**
 * 段落書式を解除する (Ctrl+Q)。スタイルが決める値に戻す。
 * 配置・字下げ・間隔・番号を外し、スタイル (pStyle) は残す。
 */
export function clearParagraphFormatting(editor: Editor): void {
  const name = currentBlockName(editor)
  recordParaFormatChange(editor, name)
  editor.chain().focus().updateAttributes(name, { jc: null, ind: null, spacing: null, numPr: null }).run()
}

/** 行間 (Ctrl+1 / Ctrl+5 / Ctrl+2)。倍数。240 = 1 行 */
export function setLineMultiple(editor: Editor, multiple: number): void {
  const name = currentBlockName(editor)
  const spacing = (editor.state.selection.$from.parent.attrs['spacing'] ?? {}) as Record<string, unknown>
  recordParaFormatChange(editor, name)
  editor
    .chain()
    .focus()
    .updateAttributes(name, { spacing: { ...spacing, line: Math.round(multiple * 240), lineRule: 'auto' } })
    .run()
}

// ---- 書式のコピー / 貼り付け ----

/** 写し取った書式 */
export interface CopiedFormat {
  /** 文字書式 (太字・下線・フォントなど)。リンクやコメントは含めない */
  marks: PMMark[]
  /** 段落書式。カーソルだけ置いて写したとき、または段落まるごと選んで写したときだけ */
  paragraph: Pick<ParagraphAttrs, 'pStyle' | 'jc' | 'ind' | 'spacing'> | null
}

/** 書式として写すマーク。リンク・コメント・変更履歴の印は中身なので写さない */
const FORMAT_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'doubleStrike', 'textStyle'])

export function copyFormat(editor: Editor): CopiedFormat {
  const { state } = editor
  const { $from, empty, from, to } = state.selection
  const marks = (empty ? (state.storedMarks ?? $from.marks()) : marksAt(editor, from)).filter((m) =>
    FORMAT_MARKS.has(m.type.name)
  )
  const parent = $from.parent
  const wholeParagraph = !empty && from <= $from.start() && to >= $from.end()
  const attrs = parent.attrs as Partial<ParagraphAttrs>
  return {
    marks,
    paragraph:
      empty || wholeParagraph
        ? { pStyle: attrs.pStyle ?? null, jc: attrs.jc ?? null, ind: attrs.ind ?? null, spacing: attrs.spacing ?? null }
        : null
  }
}

/** 選択の先頭の文字に付いているマーク */
function marksAt(editor: Editor, pos: number): readonly PMMark[] {
  const $pos = editor.state.doc.resolve(pos)
  const after = $pos.nodeAfter
  return after?.isText ? after.marks : $pos.marks()
}

/**
 * 写した書式を当てる。
 *
 * 選択範囲があればその文字に。カーソルだけなら、カーソルのある語に (Word と同じ)。
 * 段落書式を写していれば、選択にかかる段落にも当てる。
 */
export function pasteFormat(editor: Editor, format: CopiedFormat): void {
  let { from, to } = editor.state.selection
  if (from === to) {
    const word = wordAround(editor, from)
    if (word) ({ from, to } = word)
  }
  recordRunFormatChange(editor)
  const { schema } = editor.state
  const tr = editor.state.tr
  if (from < to) {
    for (const name of FORMAT_MARKS) {
      const type = schema.marks[name]
      if (type) tr.removeMark(from, to, type)
    }
    for (const mark of format.marks) tr.addMark(from, to, mark)
  }
  if (format.paragraph) {
    const para = format.paragraph
    editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, (node, pos) => {
      if (!node.isTextblock) return true
      const paragraph = schema.nodes['paragraph']
      const type = node.type.name === 'heading' && !para.pStyle?.startsWith('Heading') && paragraph ? paragraph : node.type
      tr.setNodeMarkup(pos, type, type.create({ ...node.attrs, ...para }).attrs)
      return false
    })
  }
  if (tr.docChanged) editor.view.dispatch(tr)
  editor.commands.focus()
}

/** pos を含む語の範囲 (空白・句読点で区切る)。語の上でなければ null */
function wordAround(editor: Editor, pos: number): { from: number; to: number } | null {
  const $pos = editor.state.doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock) return null
  const text = parent.textBetween(0, parent.content.size, '￼', '￼')
  const offset = $pos.parentOffset
  const isWord = (ch: string | undefined): boolean => ch != null && !/[\s\u3000、。，．,.!?！？「」『』（）()￼]/.test(ch)
  let start = offset
  let end = offset
  while (start > 0 && isWord(text[start - 1])) start--
  while (end < text.length && isWord(text[end])) end++
  if (start === end) return null
  return { from: $pos.start() + start, to: $pos.start() + end }
}

