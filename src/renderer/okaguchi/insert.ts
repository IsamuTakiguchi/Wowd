import type { Editor } from '@tiptap/react'
import type { RunProps } from '@core/model/types'
import type { PartyLine } from '@core/okaguchi/party'
import { DEFAULT_RUN_PROPS } from '@core/css/runCss'

/** いまのカーソル位置の文字書式 (無ければ null) */
function currentRunProps(editor: Editor): RunProps | null {
  const { state } = editor
  const marks = state.storedMarks ?? state.selection.$from.marks()
  const mark = marks.find((m) => m.type.name === 'textStyle')
  return (mark?.attrs['runProps'] as RunProps | null | undefined) ?? null
}

/**
 * 文字の並びをカーソル位置に差し込む (選択範囲があれば置き換える)。
 *
 * 横幅 (w) を指定した部分だけ、いまの文字書式に横幅を足す。
 * フォントや大きさは周りに合わせる。
 */
export function insertRuns(editor: Editor, runs: { text: string; w?: number | null }[]): void {
  const base = currentRunProps(editor)
  const others = (editor.state.storedMarks ?? editor.state.selection.$from.marks())
    .filter((m) => m.type.name !== 'textStyle')
    .map((m) => m.toJSON() as object)
  const content = runs
    .filter((r) => r.text.length > 0)
    .map((r) => {
      const w = r.w != null && r.w !== 100 ? r.w : null
      const props: RunProps | null = w != null ? { ...(base ?? DEFAULT_RUN_PROPS), w } : base
      const marks = [...others]
      if (props) marks.push({ type: 'textStyle', attrs: { runProps: props } })
      return { type: 'text', text: r.text, marks }
    })
  if (content.length === 0) return
  editor.chain().focus().insertContent(content).run()
  // 差し込んだあとに打つ文字は、横幅を縮めない (元のマクロも 100% に戻している)
  const after = editor.state.tr.setStoredMarks(
    editor.state.selection.$from
      .marks()
      .filter((m) => m.type.name !== 'textStyle')
      .concat(base ? [editor.schema.marks['textStyle']!.create({ runProps: base })] : [])
  )
  editor.view.dispatch(after)
}

/** 平文を差し込む */
export function insertPlain(editor: Editor, text: string): void {
  insertRuns(editor, [{ text }])
}

/** 段落の並びを差し込む (当事者欄など、複数行のもの) */
export function insertParagraphs(editor: Editor, lines: string[]): void {
  if (lines.length === 0) return
  const { $from } = editor.state.selection
  const atEmptyParagraph = $from.parent.isTextblock && $from.parent.content.size === 0
  const content = lines.map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : []
  }))
  if (atEmptyParagraph) {
    // 空の段落にいるなら、その段落を置き換える
    const pos = $from.before()
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + $from.parent.nodeSize }, content)
      .run()
    return
  }
  editor.chain().focus().insertContent(content).run()
}

let fitId = Math.floor(Math.random() * 1_000_000) + 1_000

/**
 * 当事者欄などの段落を差し込む。
 *
 * 字下げは字数 (w:leftChars)。均等割り付けは Word の w:fitText で表すので、
 * Word で開いても同じに割り付けられる。
 *
 * @param pitchTwip 1 字の幅 (twip)。割り付けの幅の計算に使う
 */
export function insertLines(editor: Editor, lines: PartyLine[], pitchTwip: number): void {
  if (lines.length === 0) return
  const content = lines.map((line) => ({
    type: 'paragraph',
    attrs: {
      ...(line.align === 'center' ? { jc: 'center' } : {}),
      ind: {
        leftChars: Math.round(line.indent * 100),
        left: Math.round(line.indent * pitchTwip),
        firstLineChars: 0,
        firstLine: 0
      }
    },
    content: line.runs.map((run) =>
      run.fit
        ? {
            type: 'text',
            text: run.text,
            marks: [
              {
                type: 'textStyle',
                attrs: {
                  runProps: {
                    ...DEFAULT_RUN_PROPS,
                    fitText: { val: Math.round(run.fit * pitchTwip), id: fitId++ }
                  }
                }
              }
            ]
          }
        : { type: 'text', text: run.text }
    )
  }))
  const { $from } = editor.state.selection
  if ($from.parent.isTextblock && $from.parent.content.size === 0) {
    const pos = $from.before()
    editor.chain().focus().insertContentAt({ from: pos, to: pos + $from.parent.nodeSize }, content).run()
    return
  }
  editor.chain().focus().insertContent(content).run()
}
