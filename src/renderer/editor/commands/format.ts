import type { Editor } from '@tiptap/react'
import type { RunProps, ParagraphAttrs, Justification } from '@core/model/types'
import { DEFAULT_RUN_PROPS } from '../extensions/WRunProps'

/** 選択範囲の現在の rPr を読む。複数マークがある場合は先頭のものを返す */
export function currentRunProps(editor: Editor | null): RunProps | null {
  if (!editor) return null
  const attrs = editor.getAttributes('textStyle') as { runProps?: RunProps | null }
  return attrs.runProps ?? null
}

/** rPr の一部だけを差し替える。他の項目は保つ */
export function patchRunProps(editor: Editor, patch: Partial<RunProps>): void {
  const base = currentRunProps(editor) ?? DEFAULT_RUN_PROPS
  const next: RunProps = { ...base, ...patch }
  const empty = (Object.keys(DEFAULT_RUN_PROPS) as (keyof RunProps)[]).every(
    (k) => next[k] == null
  )
  if (empty) editor.chain().focus().unsetMark('textStyle').run()
  else editor.chain().focus().setMark('textStyle', { runProps: next }).run()
}

/** 現在の段落 (または見出し) のノード名 */
export function currentBlockName(editor: Editor | null): string {
  if (!editor) return 'paragraph'
  return editor.state.selection.$from.parent.type.name
}

export function currentParagraphAttrs(editor: Editor | null): Partial<ParagraphAttrs> {
  if (!editor) return {}
  return editor.state.selection.$from.parent.attrs as Partial<ParagraphAttrs>
}

/** 段落属性の一部を差し替える。段落と見出しのどちらにも効く */
export function patchParagraph(editor: Editor, patch: Partial<ParagraphAttrs>): void {
  editor.chain().focus().updateAttributes(currentBlockName(editor), patch).run()
}

export function setAlignment(editor: Editor, jc: Justification | null): void {
  patchParagraph(editor, { jc })
}

/** 行間。240 = 1 行分 (w:line の auto 単位) */
export function setLineSpacing(editor: Editor, multiple: number): void {
  const attrs = currentParagraphAttrs(editor)
  patchParagraph(editor, {
    spacing: { ...(attrs.spacing ?? {}), line: Math.round(multiple * 240), lineRule: 'auto' }
  })
}

/** インデントを 1 段ぶん増減する。1 段 = 2 文字 (日本語 Word の既定に合わせる) */
export function changeIndent(editor: Editor, direction: 1 | -1): void {
  const attrs = currentParagraphAttrs(editor)
  const ind = attrs.ind ?? {}
  // *Chars が使われている文書ではそちらを動かす。混在させると Word 側で片方が無視される
  if (ind.leftChars != null) {
    const next = Math.max(0, ind.leftChars + direction * 200)
    patchParagraph(editor, { ind: { ...ind, leftChars: next } })
    return
  }
  const next = Math.max(0, (ind.left ?? 0) + direction * 420)
  patchParagraph(editor, { ind: { ...ind, left: next } })
}

export function applyStyle(editor: Editor, styleId: string): void {
  const level = /^Heading([1-9])$/.exec(styleId)
  if (level) {
    editor
      .chain()
      .focus()
      .setNode('heading', { level: Number(level[1]), pStyle: styleId, outlineLvl: Number(level[1]) - 1 })
      .run()
    return
  }
  editor.chain().focus().setNode('paragraph', { pStyle: styleId === 'Normal' ? null : styleId }).run()
}

/** 選択範囲の文字書式をすべて外す。段落書式には触らない */
export function clearFormatting(editor: Editor): void {
  editor.chain().focus().unsetAllMarks().run()
}

/** リストの適用と解除 */
export function toggleList(editor: Editor, numId: number): void {
  const attrs = currentParagraphAttrs(editor)
  if (attrs.numPr?.numId === numId) {
    patchParagraph(editor, { numPr: null })
    return
  }
  patchParagraph(editor, { numPr: { numId, ilvl: attrs.numPr?.ilvl ?? 0 } })
}
