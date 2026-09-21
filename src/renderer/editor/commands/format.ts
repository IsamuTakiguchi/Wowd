import type { Editor } from '@tiptap/react'
import type { RunProps, ParagraphAttrs, Justification, ParagraphIndent } from '@core/model/types'
import { DEFAULT_RUN_PROPS } from '@core/css/runCss'
import { recordRunFormatChange, recordParaFormatChange } from '../track/formatRevision'

/** 選択範囲の現在の rPr を読む。複数マークがある場合は先頭のものを返す */
export function currentRunProps(editor: Editor | null): RunProps | null {
  if (!editor) return null
  const attrs = editor.getAttributes('textStyle') as { runProps?: RunProps | null }
  return attrs.runProps ?? null
}

/** rPr の一部だけを差し替える。他の項目は保つ */
export function patchRunProps(editor: Editor, patch: Partial<RunProps>): void {
  // 記録中なら、変える**前**に変更前の書式を抱えさせる
  recordRunFormatChange(editor)
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
  const name = currentBlockName(editor)
  recordParaFormatChange(editor, name)
  editor.chain().focus().updateAttributes(name, patch).run()
}

/**
 * 太字などのマークを切り替える。
 *
 * リボンから editor.chain().toggleBold() を直に呼ぶと記録を挟めない。
 * 書式を変える経路はすべてここを通す
 */
export function toggleRunMark(editor: Editor, name: string): void {
  recordRunFormatChange(editor)
  editor.chain().focus().toggleMark(name).run()
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

/** いま選んでいる段落の字下げ。無指定なら null */
export function currentIndent(editor: Editor | null): ParagraphIndent | null {
  return currentParagraphAttrs(editor).ind ?? null
}

/**
 * 字下げを差し替える。ルーラの三角をつかんで動かしたときに使う。
 *
 * 文字単位の指定 (leftChars など) がある文書では、対応する文字単位の値を消してから
 * twip を入れる。両方あると Word はどちらか片方を無視するので、
 * 画面で見えている値と Word で開いた値が食い違う。
 */
export function setIndent(editor: Editor, patch: Partial<ParagraphIndent>): void {
  const current = currentIndent(editor) ?? {}
  const next: ParagraphIndent = { ...current, ...patch }
  const pairs: [keyof ParagraphIndent, keyof ParagraphIndent][] = [
    ['left', 'leftChars'],
    ['right', 'rightChars'],
    ['firstLine', 'firstLineChars'],
    ['hanging', 'hangingChars']
  ]
  for (const [twipKey, charsKey] of pairs) {
    if (patch[twipKey] !== undefined) delete next[charsKey]
  }

  /*
   * 1 行目の字下げとぶら下げは排他。**0 を入れるのではなく消す。**
   * 0 でも「指定されている」ことに変わりはなく、CSS への写像
   * (indentToCss) はぶら下げを先に見るので、hanging: 0 が残っていると
   * firstLine が無視されて字下げが効かない (実際にそうなった)。
   */
  if (patch.firstLine != null || patch.firstLineChars != null) {
    delete next.hanging
    delete next.hangingChars
  }
  if (patch.hanging != null || patch.hangingChars != null) {
    delete next.firstLine
    delete next.firstLineChars
  }

  patchParagraph(editor, { ind: next })
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
  recordParaFormatChange(editor, currentBlockName(editor))
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
  recordRunFormatChange(editor)
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
