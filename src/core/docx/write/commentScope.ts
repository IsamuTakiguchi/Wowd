import type { BlockNode, InlineNode, CommentRecord } from '../../model/types'

/**
 * コメント範囲の状態。**文書全体で 1 つ**共有する。
 *
 * コメントはランを包むのではなく、範囲の前後に印を置く形で表される。
 * この状態を段落ごとに作り直すと、複数段落にまたがるコメントが
 * **段落ごとに開いて閉じる**ことになり、同じ w:id の
 * commentRangeStart / End / commentReference が何組も出る。
 * Word は 1 つの id に 1 つの範囲しか想定しないので、
 * 「問題を修復しますか」になる。
 *
 * 実際にそうなっていた (5 段落を選んで付けたコメントが 5 組に割れた)。
 */
export interface CommentScope {
  /** いま開いている範囲。段落をまたいで持ち越す */
  open: string[]
  /** id ごとの「まだ後に残っている出現数」。0 になったところで閉じる */
  remaining: Map<string, number>
  /** 親 id → 返信の id。返信も親と同じ範囲に錨を下ろす */
  replies: Map<string, string[]>
  /** id → 参照ランの w:rPr (原文のまま)。読み込み時に拾ったもの */
  refProps: Map<string, string>
}

/**
 * 返信のコメントにも範囲と参照が要る。
 *
 * comments.xml にあるのに document.xml から参照されないコメントは
 * 錨の無いコメントで、Word はこれも壊れた文書として扱う。
 * 返信は本文に印を持たない (返信を足すときに選択範囲が無い) ので、
 * **親の範囲に相乗りさせる**。Word が書くのもこの形。
 */
function expandReplies(ids: string[], replies: Map<string, string[]>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
    for (const child of replies.get(id) ?? []) push(child)
  }
  for (const id of ids) push(id)
  return out
}

/** id → 参照ランの書式。Word が付けた「コメント参照」スタイルなどを保つ */
export function refPropsTable(comments: Map<string, CommentRecord>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [id, record] of comments) {
    if (record.refRPr) out.set(id, record.refRPr)
  }
  return out
}

/** 親 id → 返信の id の表を作る。親が居ない返信は諦めてそのまま扱う */
export function replyTable(comments: Map<string, CommentRecord>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [id, record] of comments) {
    if (!record.parentId) continue
    const list = out.get(record.parentId)
    if (list) list.push(id)
    else out.set(record.parentId, [id])
  }
  return out
}

/** 文書全体を先に走査して、各 id の出現数を数える */
export function buildCommentScope(
  blocks: BlockNode[],
  replies: Map<string, string[]> = new Map(),
  refProps: Map<string, string> = new Map()
): CommentScope {
  const remaining = new Map<string, number>()
  const countInline = (nodes: InlineNode[] | undefined): void => {
    for (const node of nodes ?? []) {
      if (node.type === 'ruby') {
        countInline(node.content)
        continue
      }
      if (node.type !== 'text') continue
      const ids = node.marks?.find((m) => m.type === 'comment')?.attrs as
        | { ids: string[] }
        | undefined
      for (const id of expandReplies(ids?.ids ?? [], replies)) {
        remaining.set(id, (remaining.get(id) ?? 0) + 1)
      }
    }
  }
  const walk = (list: BlockNode[]): void => {
    for (const block of list) {
      if (block.type === 'paragraph') countInline(block.content)
      else if (block.type === 'table') {
        for (const row of block.content) for (const cell of row.content) walk(cell.content)
      }
    }
  }
  walk(blocks)
  return { open: [], remaining, replies, refProps }
}

/** 消費したぶんだけ残数を減らす */
export function consumeComments(scope: CommentScope, ids: string[], times: number): void {
  for (const id of expandReplies(ids, scope.replies)) {
    const left = (scope.remaining.get(id) ?? 0) - times
    scope.remaining.set(id, left > 0 ? left : 0)
  }
}

/** 範囲に入っている id を、返信まで展開して返す */
export function anchoredIds(scope: CommentScope, ids: string[]): string[] {
  return expandReplies(ids, scope.replies)
}
