import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { ParagraphAttrs, RunProps } from '@core/model/types'
import { DEFAULT_RUN_PROPS } from '@core/css/runCss'
import {
  hasRunFormatChange,
  hasParaFormatChange,
  stripRunFormatChange,
  stripParaFormatChange,
  restoredRunMarks,
  restoredParaAttrs
} from '@core/revisions/formatChange'

/**
 * 変更の承諾と取り消し。
 *
 * 承諾 = 挿入を本文にする / 削除を実行する
 * 取り消し = 挿入を消す / 削除を無かったことにする
 *
 * 段落記号の挿入・削除も同じ規則に従う。承諾された削除や
 * 取り消された挿入では、段落は次の段落と結合される。
 */

export type RevisionKind = 'insertion' | 'deletion'
export type RevisionAction = 'accept' | 'reject'

export interface RevisionRange {
  from: number
  to: number
  kind: RevisionKind
  author: string
}

/** 範囲内の改訂を、前から順に列挙する */
export function revisionRanges(doc: PMNode, from = 0, to = doc.content.size): RevisionRange[] {
  const out: RevisionRange[] = []

  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true
    for (const mark of node.marks) {
      const kind = mark.type.name
      if (kind !== 'insertion' && kind !== 'deletion') continue
      const author = String(mark.attrs['author'] ?? '')
      const last = out[out.length - 1]
      // 同じ種類・同じ著者の隣り合う断片は 1 つの変更として扱う
      if (last && last.kind === kind && last.author === author && last.to === pos) {
        last.to = pos + node.nodeSize
      } else {
        out.push({ from: pos, to: pos + node.nodeSize, kind, author })
      }
    }
    return true
  })

  return out
}

/** 段落記号に印が付いた段落の位置 */
function paragraphRevisions(
  doc: PMNode,
  from: number,
  to: number
): { pos: number; node: PMNode; kind: 'ins' | 'del' }[] {
  const out: { pos: number; node: PMNode; kind: 'ins' | 'del' }[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const rev = node.attrs['paraMarkRevision'] as { kind: 'ins' | 'del' } | null | undefined
    if (rev) out.push({ pos, node, kind: rev.kind })
    return false
  })
  return out
}

/**
 * 書式の変更 (w:rPrChange / w:pPrChange) を承諾または取り消す。
 *
 * 承諾 = 記録を外して今の書式を残す
 * 取り消し = 変更前の書式に戻して記録を外す
 *
 * これを飛ばすと「すべて元に戻す」で書式だけが戻らず、
 * **取り消したはずの書式が残る。**挿入・削除だけ見ていたときはそうなっていた。
 */
function applyFormatRevisions(
  tr: Transaction,
  state: EditorState,
  action: RevisionAction,
  from: number,
  to: number
): void {
  const textStyle = state.schema.marks['textStyle']

  // 段落。後ろから処理する
  const paras: { pos: number; node: PMNode }[] = []
  tr.doc.nodesBetween(from, Math.min(to, tr.doc.content.size), (node, pos) => {
    if (!node.isTextblock) return true
    const attrs = node.attrs as ParagraphAttrs
    if (hasParaFormatChange(attrs.rawPPr)) paras.push({ pos, node })
    return false
  })
  for (let i = paras.length - 1; i >= 0; i--) {
    const entry = paras[i]
    if (!entry) continue
    const attrs = entry.node.attrs as ParagraphAttrs
    const restored = action === 'reject' ? restoredParaAttrs(attrs.rawPPr) : null
    tr.setNodeMarkup(entry.pos, undefined, {
      ...attrs,
      ...(restored ?? {}),
      rawPPr: stripParaFormatChange(restored ? (restored.rawPPr ?? null) : attrs.rawPPr)
    })
  }

  if (!textStyle) return

  // ラン。位置がずれないよう後ろから
  const runs: { from: number; to: number; props: RunProps }[] = []
  tr.doc.nodesBetween(from, Math.min(to, tr.doc.content.size), (node, pos) => {
    if (!node.isText) return true
    const props = (node.marks.find((m) => m.type.name === 'textStyle')?.attrs['runProps'] ??
      null) as RunProps | null
    if (props && hasRunFormatChange(props.rawRPr)) {
      runs.push({ from: pos, to: pos + node.nodeSize, props })
    }
    return true
  })
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]
    if (!run) continue
    const start = Math.max(from, run.from)
    const end = Math.min(to, run.to)
    if (end <= start) continue

    if (action === 'accept') {
      tr.addMark(
        start,
        end,
        textStyle.create({ runProps: { ...run.props, rawRPr: stripRunFormatChange(run.props.rawRPr) } })
      )
      continue
    }

    // 取り消し: 変更前のマークに戻す。いまのマークは一度すべて外す
    const restored = restoredRunMarks(run.props.rawRPr) ?? []
    for (const type of Object.values(state.schema.marks)) {
      if (type.name === 'insertion' || type.name === 'deletion' || type.name === 'comment') continue
      tr.removeMark(start, end, type)
    }
    for (const mark of restored) {
      const type = state.schema.marks[mark.type]
      if (!type) continue
      const attrs =
        mark.type === 'textStyle'
          ? { runProps: { ...DEFAULT_RUN_PROPS, ...('attrs' in mark ? mark.attrs : {}) } }
          : 'attrs' in mark
            ? (mark.attrs as Record<string, unknown>)
            : undefined
      tr.addMark(start, end, type.create(attrs as never))
    }
  }
}

/**
 * 指定範囲の変更を承諾または取り消す。
 *
 * 後ろから処理する。位置がずれるのを避けるため。
 */
export function applyRevisions(
  state: EditorState,
  action: RevisionAction,
  from: number,
  to: number
): Transaction | null {
  const tr = state.tr
  const insertion = state.schema.marks['insertion']
  const deletion = state.schema.marks['deletion']
  if (!insertion || !deletion) return null

  // 段落記号を先に片づける。本文を消したあとだと位置が合わなくなる
  const paras = paragraphRevisions(state.doc, from, to)
  for (let i = paras.length - 1; i >= 0; i--) {
    const entry = paras[i]
    if (!entry) continue
    const { pos, node, kind } = entry
    // 挿入を取り消す / 削除を承諾する → 段落記号が消える = 次の段落と結合
    const remove = (kind === 'ins' && action === 'reject') || (kind === 'del' && action === 'accept')
    if (remove) {
      const end = pos + node.nodeSize
      // 次の段落があるときだけ結合できる。文末の段落記号は消せない
      if (end < tr.doc.content.size) tr.join(end)
      continue
    }
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, paraMarkRevision: null })
  }

  const ranges = revisionRanges(tr.doc, Math.min(from, tr.doc.content.size), Math.min(to, tr.doc.content.size))
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i]
    if (!range) continue
    const drop =
      (range.kind === 'insertion' && action === 'reject') ||
      (range.kind === 'deletion' && action === 'accept')
    if (drop) {
      tr.delete(range.from, range.to)
      continue
    }
    tr.removeMark(range.from, range.to, range.kind === 'insertion' ? insertion : deletion)
  }

  // 書式の変更は最後に片づける。本文を消したあとの位置で処理する
  applyFormatRevisions(tr, state, action, Math.min(from, tr.doc.content.size), Math.min(to, tr.doc.content.size))

  return tr.steps.length > 0 ? tr : null
}

/** 文書全体の変更を承諾または取り消す */
export function applyAllRevisions(state: EditorState, action: RevisionAction): Transaction | null {
  return applyRevisions(state, action, 0, state.doc.content.size)
}

/** その位置にかかっている変更。無ければ null */
export function revisionAt(doc: PMNode, pos: number): RevisionRange | null {
  for (const range of revisionRanges(doc)) {
    if (range.from <= pos && pos <= range.to) return range
  }
  for (const para of paragraphRevisions(doc, 0, doc.content.size)) {
    const end = para.pos + para.node.nodeSize
    if (para.pos <= pos && pos <= end) {
      return {
        from: para.pos,
        to: end,
        kind: para.kind === 'ins' ? 'insertion' : 'deletion',
        author: ''
      }
    }
  }
  return null
}

/** カーソル位置から見て次 (または前) の変更の位置。無ければ null */
export function findRevision(
  doc: PMNode,
  cursor: number,
  direction: 1 | -1
): RevisionRange | null {
  const all = revisionRanges(doc)
  const paras = paragraphRevisions(doc, 0, doc.content.size).map(
    (p): RevisionRange => ({
      from: p.pos + p.node.nodeSize - 1,
      to: p.pos + p.node.nodeSize,
      kind: p.kind === 'ins' ? 'insertion' : 'deletion',
      author: String(
        (p.node.attrs['paraMarkRevision'] as { meta?: { author?: string } } | null)?.meta?.author ??
          ''
      )
    })
  )
  const ranges = [...all, ...paras].sort((a, b) => a.from - b.from)
  if (ranges.length === 0) return null

  if (direction > 0) {
    return ranges.find((r) => r.from > cursor) ?? ranges[0] ?? null
  }
  const before = ranges.filter((r) => r.to < cursor)
  return before[before.length - 1] ?? ranges[ranges.length - 1] ?? null
}
