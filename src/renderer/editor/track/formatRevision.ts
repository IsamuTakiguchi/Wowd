import type { Editor } from '@tiptap/react'
import type { Transaction } from '@tiptap/pm/state'
import type { Mark as PMMark } from '@tiptap/pm/model'
import type { ParagraphAttrs, RunProps, RevisionMeta } from '@core/model/types'
import { DEFAULT_RUN_PROPS } from '@core/css/runCss'
import {
  withRunFormatChange,
  withParaFormatChange,
  hasRunFormatChange,
  hasParaFormatChange
} from '@core/revisions/formatChange'
import { isoNow, nextRevisionId } from './track'
import type { TrackChangesStorage } from './TrackChanges'

/**
 * 書式を変えたことを変更履歴に残す。
 *
 * 挿入と削除は prosemirror-changeset が見つけてくれるが、
 * **書式だけの変更は見つけてくれない** (中身が同じなので差分に出ない)。
 * 実測でも、記録中に太字を付けても履歴は付かなかった。
 *
 * そこで、書式を変えるコマンドの**手前**でここを呼び、
 * 変更前の書式を w:rPrChange / w:pPrChange として抱えておく。
 * 「手前」なのが要点で、変えたあとでは変更前が分からない。
 */

function storageOf(editor: Editor): TrackChangesStorage | null {
  const storage = (editor.storage as unknown as Record<string, unknown>)['trackChanges']
  return (storage as TrackChangesStorage | undefined) ?? null
}

/** 記録中なら著者名を返す。止めていれば null */
export function trackingAuthor(editor: Editor): string | null {
  const storage = storageOf(editor)
  return storage?.enabled ? storage.author : null
}

function metaFor(editor: Editor, author: string): RevisionMeta {
  return { id: nextRevisionId(editor.state.doc), author, date: isoNow() }
}

/**
 * 選択範囲のランに「変更前の書式」を抱えさせる。
 *
 * 範囲ごとに元の書式が違うので、テキストノード単位で作る。
 * すでに抱えているものは触らない (最初の「変更前」を保つため)。
 */
export function recordRunFormatChange(editor: Editor): void {
  const author = trackingAuthor(editor)
  if (!author) return

  const { from, to } = editor.state.selection
  // 折りたたんだカーソルでは、まだ何も変わっていない
  if (from === to) return

  const textStyle = editor.state.schema.marks['textStyle']
  if (!textStyle) return

  const meta = metaFor(editor, author)
  const tr: Transaction = editor.state.tr
  let touched = false

  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    const start = Math.max(from, pos)
    const end = Math.min(to, pos + node.nodeSize)
    if (end <= start) return true

    const marks = node.marks as readonly PMMark[]
    const current = (marks.find((m) => m.type.name === 'textStyle')?.attrs['runProps'] ??
      null) as RunProps | null
    if (hasRunFormatChange(current?.rawRPr ?? null)) return true

    const previous = marks.map((m) => ({ type: m.type.name, attrs: m.attrs })) as never
    const rawRPr = withRunFormatChange(current?.rawRPr ?? null, previous, meta)
    const next: RunProps = { ...(current ?? DEFAULT_RUN_PROPS), rawRPr }
    tr.addMark(start, end, textStyle.create({ runProps: next }))
    touched = true
    return true
  })

  if (touched) editor.view.dispatch(tr)
}

/** 段落に「変更前の書式」を抱えさせる */
export function recordParaFormatChange(editor: Editor, blockName: string): void {
  const author = trackingAuthor(editor)
  if (!author) return

  const { $from } = editor.state.selection
  const node = $from.parent
  if (node.type.name !== blockName) return

  const attrs = node.attrs as ParagraphAttrs
  if (hasParaFormatChange(attrs.rawPPr)) return

  // w:sectPr は CT_PPrBase に入れられないので、
  // 変更前の書式を組み立てる側で外している。ここでは空の表で足りる
  const rawPPr = withParaFormatChange(attrs.rawPPr, attrs, new Map(), metaFor(editor, author))
  editor.chain().updateAttributes(blockName, { rawPPr }).run()
}
