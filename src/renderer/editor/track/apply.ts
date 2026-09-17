import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

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
