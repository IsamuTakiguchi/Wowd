import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Node as PMNode, Slice, Fragment, type Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { buildExtensions } from '@renderer/editor/extensions'
import { buildTrackingTransaction, isoNow, nextRevisionId } from '@renderer/editor/track/track'
import { applyAllRevisions, revisionRanges, findRevision } from '@renderer/editor/track/apply'
import { DEFAULT_PARAGRAPH_ATTRS } from '@renderer/editor/extensions/paragraphAttrs'
import {
  withRunFormatChange,
  withParaFormatChange,
  hasRunFormatChange,
  hasParaFormatChange
} from '@core/revisions/formatChange'
import { DEFAULT_RUN_PROPS } from '@core/css/runCss'

/**
 * 変更履歴の不変条件。
 *
 * ここが壊れると赤入りが失われる。もっとも壊してはいけない部分なので、
 * 打鍵・BackSpace・範囲削除・貼り付け・一括置換・取り消しのそれぞれで
 * 次の 2 つを確かめる。
 *
 *   すべて承諾した本文 = 記録しなかった場合の本文
 *   すべて取り消した本文 = 編集前の本文
 *
 * EditorView は使わない。EditorState だけなら DOM 無しで動くので、
 * 実際のスキーマとプラグインをそのまま使って速く回せる。
 */

const schema: Schema = getSchema(buildExtensions())

function paragraph(text: string): object {
  return {
    type: 'paragraph',
    attrs: { ...DEFAULT_PARAGRAPH_ATTRS },
    content: text.length > 0 ? [{ type: 'text', text }] : []
  }
}

function stateOf(...paragraphs: string[]): EditorState {
  const doc = PMNode.fromJSON(schema, {
    type: 'doc',
    content: paragraphs.map(paragraph)
  })
  return EditorState.create({ doc, schema })
}

/** 段落ごとの本文。段落の区切りも見たいので join しない */
function textOf(doc: PMNode): string[] {
  const out: string[] = []
  doc.forEach((node) => out.push(node.textContent))
  return out
}

/** 編集をそのまま適用する (記録しない) */
function edit(state: EditorState, change: (tr: Transaction) => void): EditorState {
  const tr = state.tr
  change(tr)
  return state.apply(tr)
}

/** 編集を適用し、変更履歴として記録した状態を返す */
function tracked(state: EditorState, change: (tr: Transaction) => void): EditorState {
  const tr = state.tr
  change(tr)
  const plain = state.apply(tr)
  const track = buildTrackingTransaction(state, plain, tr.mapping.maps, {
    author: '校閲者',
    nextId: () => nextRevisionId(plain.doc),
    now: isoNow
  })
  return track ? plain.apply(track) : plain
}

function acceptAll(state: EditorState): EditorState {
  const tr = applyAllRevisions(state, 'accept')
  return tr ? state.apply(tr) : state
}

function rejectAll(state: EditorState): EditorState {
  const tr = applyAllRevisions(state, 'reject')
  return tr ? state.apply(tr) : state
}

/**
 * 不変条件をまとめて確かめる。
 * @param before 編集前
 * @param change 編集の中身
 */
function checkInvariants(before: EditorState, change: (tr: Transaction) => void): EditorState {
  const plain = edit(before, change)
  const marked = tracked(before, change)

  expect(textOf(acceptAll(marked).doc), 'すべて承諾すると記録しない場合と同じになる').toEqual(
    textOf(plain.doc)
  )
  expect(textOf(rejectAll(marked).doc), 'すべて取り消すと編集前に戻る').toEqual(textOf(before.doc))
  return marked
}

describe('変更履歴の記録', () => {
  it('文字を打つと挿入として記録される', () => {
    const before = stateOf('あいうえお')
    const marked = checkInvariants(before, (tr) => tr.insertText('かき', 3))

    expect(marked.doc.textContent).toBe('あいかきうえお')
    const ranges = revisionRanges(marked.doc)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]?.kind).toBe('insertion')
    expect(ranges[0]?.author).toBe('校閲者')
  })

  it('BackSpace で消した文字は消えずに削除として残る', () => {
    const before = stateOf('あいうえお')
    // 「う」を 1 文字消す
    const marked = checkInvariants(before, (tr) => tr.delete(3, 4))

    // 文字は残っている。承諾するまでは文書の一部
    expect(marked.doc.textContent).toBe('あいうえお')
    const ranges = revisionRanges(marked.doc)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]?.kind).toBe('deletion')
  })

  it('範囲を選んで消しても全文が残る', () => {
    const before = stateOf('あいうえおかきくけこ')
    const marked = checkInvariants(before, (tr) => tr.delete(3, 8))
    expect(marked.doc.textContent).toBe('あいうえおかきくけこ')
  })

  it('範囲を選んで置き換えると、削除と挿入の両方が残る', () => {
    const before = stateOf('あいうえお')
    const marked = checkInvariants(before, (tr) => tr.insertText('XY', 2, 4))

    const kinds = revisionRanges(marked.doc).map((r) => r.kind)
    expect(kinds).toContain('insertion')
    expect(kinds).toContain('deletion')
    expect(marked.doc.textContent).toContain('いう')
    expect(marked.doc.textContent).toContain('XY')
  })

  it('貼り付け (複数段落) でも不変条件が保たれる', () => {
    const before = stateOf('あいうえお')
    checkInvariants(before, (tr) => {
      const slice = new Slice(
        Fragment.fromArray([
          PMNode.fromJSON(schema, paragraph('貼り付け1')),
          PMNode.fromJSON(schema, paragraph('貼り付け2'))
        ]),
        1,
        1
      )
      tr.replace(3, 3, slice)
    })
  })

  it('段落をまたぐ削除でも不変条件が保たれる', () => {
    const before = stateOf('第一段落', '第二段落')
    // 「段落」+ 段落区切り + 「第二」を消す
    const marked = checkInvariants(before, (tr) => tr.delete(3, 10))
    // 段落は結合されず、記号が削除された印だけが付く
    expect(marked.doc.childCount).toBe(2)
  })

  it('段落の分割 (Enter) が段落記号の挿入として記録される', () => {
    const before = stateOf('あいうえお')
    const marked = checkInvariants(before, (tr) => tr.split(3))

    expect(marked.doc.childCount).toBe(2)
    const first = marked.doc.firstChild
    expect(first?.attrs['paraMarkRevision']).toBeTruthy()
  })

  it('一括置換 (複数か所) でも不変条件が保たれる', () => {
    const before = stateOf('猫と犬と猫')
    checkInvariants(before, (tr) => {
      // 後ろから置き換える。前から替えると位置がずれる
      tr.insertText('虎', 5, 6)
      tr.insertText('虎', 1, 2)
    })
  })

  it('記録中に自分が入れた文字を消すと、印を重ねずに消える', () => {
    const before = stateOf('あいうえお')
    const inserted = tracked(before, (tr) => tr.insertText('XYZ', 3))
    expect(inserted.doc.textContent).toBe('あいXYZうえお')

    // いま入れた XYZ を消す
    const removed = tracked(inserted, (tr) => tr.delete(3, 6))
    expect(removed.doc.textContent).toBe('あいうえお')
    expect(revisionRanges(removed.doc)).toHaveLength(0)
  })

  it('取り消し (undo) 相当の再適用では二重に記録されない', () => {
    // undo は履歴プラグインの印で除外する。ここでは
    // 記録済みの文書をもう一度編集しても ID が積み上がらないことを見る
    const before = stateOf('あいうえお')
    const once = tracked(before, (tr) => tr.insertText('X', 3))
    const twice = tracked(once, (tr) => tr.insertText('Y', 4))

    expect(textOf(rejectAll(twice).doc)).toEqual(['あいうえお'])
    expect(textOf(acceptAll(twice).doc)).toEqual(['あいXYうえお'])
  })
})

describe('変更の承諾と取り消し', () => {
  it('挿入を承諾すると本文になり、印だけが消える', () => {
    const before = stateOf('あいうえお')
    const marked = tracked(before, (tr) => tr.insertText('X', 3))
    const accepted = acceptAll(marked)

    expect(accepted.doc.textContent).toBe('あいXうえお')
    expect(revisionRanges(accepted.doc)).toHaveLength(0)
  })

  it('削除を承諾すると文字が本当に消える', () => {
    const before = stateOf('あいうえお')
    const marked = tracked(before, (tr) => tr.delete(3, 4))
    const accepted = acceptAll(marked)

    expect(accepted.doc.textContent).toBe('あいえお')
    expect(revisionRanges(accepted.doc)).toHaveLength(0)
  })

  it('取り消すと元の本文に戻る', () => {
    const before = stateOf('あいうえお')
    const marked = tracked(before, (tr) => {
      tr.insertText('XY', 3)
      tr.delete(1, 2)
    })
    expect(rejectAll(marked).doc.textContent).toBe('あいうえお')
  })

  it('段落記号の削除を承諾すると段落が結合される', () => {
    const before = stateOf('第一段落', '第二段落')
    const marked = tracked(before, (tr) => tr.delete(5, 7))
    expect(marked.doc.childCount).toBe(2)

    const accepted = acceptAll(marked)
    expect(accepted.doc.childCount).toBe(1)
    expect(accepted.doc.textContent).toBe('第一段落第二段落')
  })

  it('段落記号の挿入を取り消すと段落が元どおりつながる', () => {
    const before = stateOf('あいうえお')
    const marked = tracked(before, (tr) => tr.split(3))
    expect(marked.doc.childCount).toBe(2)

    const rejected = rejectAll(marked)
    expect(rejected.doc.childCount).toBe(1)
    expect(rejected.doc.textContent).toBe('あいうえお')
  })
})

describe('変更箇所の移動', () => {
  it('次の変更と前の変更を順にたどれる', () => {
    const before = stateOf('あいうえおかきくけこ')
    const marked = tracked(before, (tr) => {
      tr.insertText('X', 9)
      tr.insertText('Y', 3)
    })

    const first = findRevision(marked.doc, 0, 1)
    expect(first).toBeTruthy()
    const second = findRevision(marked.doc, first?.to ?? 0, 1)
    expect(second?.from).toBeGreaterThan(first?.from ?? 0)

    const back = findRevision(marked.doc, second?.from ?? 0, -1)
    expect(back?.from).toBe(first?.from)
  })

  it('変更が無ければ null を返す', () => {
    expect(findRevision(stateOf('あいうえお').doc, 0, 1)).toBeNull()
  })
})

describe('選択の扱い', () => {
  it('記録しても選択位置が文書の外に出ない', () => {
    const before = stateOf('あいうえお')
    const withSelection = before.apply(
      before.tr.setSelection(TextSelection.create(before.doc, 3, 3))
    )
    const marked = tracked(withSelection, (tr) => tr.delete(3, 4))
    expect(marked.selection.from).toBeLessThanOrEqual(marked.doc.content.size)
    expect(marked.selection.from).toBeGreaterThanOrEqual(0)
  })
})

describe('書式の変更履歴', () => {
  /**
   * 挿入・削除と違い、書式の変更は prosemirror-changeset の差分に出ない
   * (中身が同じなので)。記録は書式コマンド側で明示的に行う。
   *
   * ここで押さえるのは、挿入・削除と**同じ不変条件**が成り立つこと:
   *   すべて承諾した姿 = 記録しなかった場合の姿
   *   すべて取り消した姿 = 編集前の姿
   * ここを落とすと「元に戻す」で書式だけが戻らない。
   */
  const META = { id: 50, author: '校閲者', date: '2026-01-01T00:00:00Z' }

  /** 段落の 1〜4 文字目を太字にし、変更前の書式を抱えさせる */
  function boldWithRecord(state: EditorState): EditorState {
    const textStyle = schema.marks['textStyle']!
    const tr = state.tr
    // 記録: 変更前 (書式なし) を w:rPrChange として抱える
    tr.addMark(
      1,
      4,
      textStyle.create({
        runProps: { ...DEFAULT_RUN_PROPS, rawRPr: withRunFormatChange(null, [], META) }
      })
    )
    tr.addMark(1, 4, schema.marks['bold']!.create())
    return state.apply(tr)
  }

  it('承諾すると記録が外れ、書式は残る', () => {
    const before = stateOf('あいうえお')
    const changed = boldWithRecord(before)
    const accepted = acceptAll(changed)

    const node = accepted.doc.nodeAt(1)
    expect(node?.marks.some((m) => m.type.name === 'bold'), '書式が消えた').toBe(true)
    const props = node?.marks.find((m) => m.type.name === 'textStyle')?.attrs['runProps'] as {
      rawRPr: string | null
    } | null
    expect(hasRunFormatChange(props?.rawRPr ?? null), '記録が残っている').toBe(false)
  })

  it('取り消すと編集前の書式に戻る', () => {
    const before = stateOf('あいうえお')
    const changed = boldWithRecord(before)
    const rejected = rejectAll(changed)

    const node = rejected.doc.nodeAt(1)
    expect(node?.marks.some((m) => m.type.name === 'bold'), '太字が残っている').toBe(false)
    const props = node?.marks.find((m) => m.type.name === 'textStyle')?.attrs['runProps'] as {
      rawRPr: string | null
    } | null
    expect(hasRunFormatChange(props?.rawRPr ?? null), '記録が残っている').toBe(false)
    expect(textOf(rejected.doc)).toEqual(textOf(before.doc))
  })

  it('段落書式も承諾と取り消しに従う', () => {
    const before = stateOf('あいうえお')
    const tr = before.tr
    const node = before.doc.child(0)
    tr.setNodeMarkup(0, undefined, {
      ...node.attrs,
      jc: 'right',
      rawPPr: withParaFormatChange(null, { ...node.attrs, jc: 'center' } as never, new Map(), META)
    })
    const changed = before.apply(tr)

    const accepted = acceptAll(changed)
    expect(accepted.doc.child(0).attrs['jc'], '承諾で書式が戻ってしまった').toBe('right')
    expect(hasParaFormatChange(accepted.doc.child(0).attrs['rawPPr'] as string | null)).toBe(false)

    const rejected = rejectAll(changed)
    expect(rejected.doc.child(0).attrs['jc'], '取り消しで書式が戻らなかった').toBe('center')
    expect(hasParaFormatChange(rejected.doc.child(0).attrs['rawPPr'] as string | null)).toBe(false)
  })
})
