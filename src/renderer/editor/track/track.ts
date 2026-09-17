import { ChangeSet } from '@tiptap/pm/changeset'
import type { Node as PMNode, Mark as PMMark, Schema } from '@tiptap/pm/model'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { StepMap } from '@tiptap/pm/transform'
import type { RevisionMeta } from '@core/model/types'

/**
 * 変更履歴の記録。
 *
 * 打たれた編集をそのまま通したうえで、後追いのトランザクションで
 * 「挿入された範囲に ins マークを付ける」「消された内容を戻して del マークを付ける」
 * という形に書き換える。差分の計算は prosemirror-changeset に任せる。
 * 自前で差分を取ると、貼り付けや一括置換のような大きな編集で破綻する。
 *
 * 削除された文字は本当には消さない。承諾するまでは文書の一部として残り、
 * 取り消せば元に戻る。これが変更履歴の要であり、
 * ここが壊れると赤入りが失われる。
 */

export interface TrackConfig {
  author: string
  /** 変更に振る ID。同じ編集の ins と del は同じ ID を共有する */
  nextId: () => number
  now: () => string
}

/** 文書中で使われている改訂 ID の最大値 + 1 */
export function nextRevisionId(doc: PMNode): number {
  let max = 0
  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === 'insertion' || mark.type.name === 'deletion') {
        max = Math.max(max, Number(mark.attrs['id']) || 0)
      }
    }
    const rev = node.attrs['paraMarkRevision'] as { meta: RevisionMeta } | null | undefined
    if (rev) max = Math.max(max, rev.meta.id)
    return true
  })
  return max + 1
}

/** 秒までの ISO8601。Word は小数秒を嫌う */
export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}

function hasMark(marks: readonly PMMark[], name: string): boolean {
  return marks.some((m) => m.type.name === name)
}

/**
 * 消された内容を「削除された文字」に作り替える。
 *
 * 記録中に自分が挿入した文字を消した場合は、印を重ねずに本当に消す。
 * Word も同じ振る舞いで、そうしないと打ち間違いの直しが
 * すべて赤入りとして残ってしまう。
 */
function markDeleted(fragment: Fragment, schema: Schema, meta: RevisionMeta): Fragment {
  const deletion = schema.marks['deletion']
  const insertion = schema.marks['insertion']
  if (!deletion || !insertion) return fragment

  const out: PMNode[] = []
  fragment.forEach((node) => {
    if (node.isInline) {
      // 記録中に挿入された文字は、消したら消えるのが正しい
      if (hasMark(node.marks, 'insertion')) return
      const kept = node.marks.filter((m) => m.type.name !== 'insertion')
      out.push(node.mark(deletion.create({ ...meta }).addToSet(kept)))
      return
    }
    const content = markDeleted(node.content, schema, meta)
    out.push(node.copy(content))
  })
  return Fragment.fromArray(out)
}

/**
 * 範囲の中で段落記号が生まれた (または消された) 段落に印を付ける。
 *
 * 段落記号はインラインの文字ではないのでマークを載せられない。
 * 段落の閉じ位置が範囲の内側にあるかどうかで見分ける。
 */
function markParagraphMarks(
  tr: Transaction,
  from: number,
  to: number,
  kind: 'ins' | 'del',
  meta: RevisionMeta
): void {
  const targets: { pos: number; node: PMNode }[] = []
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const closing = pos + node.nodeSize - 1
    if (closing >= from && closing < to && node.attrs['paraMarkRevision'] == null) {
      targets.push({ pos, node })
    }
    return false
  })
  // 後ろから当てる。setNodeMarkup は位置を変えないが、順序を揃えておく
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i]
    if (!target) continue
    tr.setNodeMarkup(target.pos, undefined, {
      ...target.node.attrs,
      paraMarkRevision: { kind, meta }
    })
  }
}

/**
 * 隣にある同じ著者の改訂の印を探す。
 *
 * 見つかればその ID と日付を使い回す。使い回さないと 1 打鍵ごとに
 * 別の変更になり、「あ」「い」「う」が 3 つの赤入りとして並んでしまう。
 * Word も連続する同じ著者の挿入は 1 つの w:ins にまとめる。
 */
function adjacentMeta(
  doc: PMNode,
  from: number,
  to: number,
  markName: string,
  author: string
): RevisionMeta | null {
  for (const pos of [from, to]) {
    if (pos < 0 || pos > doc.content.size) continue
    const resolved = doc.resolve(pos)
    for (const node of [resolved.nodeBefore, resolved.nodeAfter]) {
      const mark = node?.marks.find((m) => m.type.name === markName)
      if (mark && String(mark.attrs['author'] ?? '') === author) {
        return {
          id: Number(mark.attrs['id']) || 0,
          author,
          date: String(mark.attrs['date'] ?? '')
        }
      }
    }
  }
  return null
}

/**
 * 実際に打たれた編集を、変更履歴つきの形に書き換えるトランザクションを作る。
 *
 * @returns 書き換えが要らなければ null
 */
export function buildTrackingTransaction(
  oldState: EditorState,
  newState: EditorState,
  maps: readonly StepMap[],
  config: TrackConfig
): Transaction | null {
  const schema = newState.schema
  const insertion = schema.marks['insertion']
  const deletion = schema.marks['deletion']
  if (!insertion || !deletion) return null

  let set = ChangeSet.create(oldState.doc)
  set = set.addSteps(newState.doc, maps as StepMap[], null)
  if (set.changes.length === 0) return null

  const meta: RevisionMeta = { id: config.nextId(), author: config.author, date: config.now() }
  const tr = newState.tr

  // 後ろから処理する。前の位置は後ろの書き換えに影響されない
  for (let i = set.changes.length - 1; i >= 0; i--) {
    const change = set.changes[i]
    if (!change) continue

    if (change.toB > change.fromB) {
      // 挿入された範囲。すでに del が付いていたら剥がす。
      // 削除された部分に打ち込んだ場合、両方は付かない
      tr.removeMark(change.fromB, change.toB, deletion)
      // 続けて打った文字は前の挿入とひとまとめにする
      const insMeta =
        adjacentMeta(newState.doc, change.fromB, change.toB, 'insertion', config.author) ?? meta
      tr.addMark(change.fromB, change.toB, insertion.create({ ...insMeta }))
      // 段落の分割や複数段落の貼り付けでは、段落記号そのものが挿入される
      markParagraphMarks(tr, change.fromB, change.toB, 'ins', insMeta)
    }

    if (change.toA > change.fromA) {
      const slice = oldState.doc.slice(change.fromA, change.toA)
      const delMeta =
        adjacentMeta(newState.doc, change.fromB, change.fromB, 'deletion', config.author) ?? meta
      const content = markDeleted(slice.content, schema, delMeta)
      if (content.size === 0) continue
      const restored = new Slice(content, slice.openStart, slice.openEnd)
      const at = change.fromB
      try {
        tr.replace(at, at, restored)
      } catch {
        // 構造が合わず戻せない場合は、履歴を残せないまま編集を通す。
        // ここで例外を投げるとエディタごと止まってしまう
        continue
      }
      markParagraphMarks(tr, at, at + restored.size, 'del', delMeta)
    }
  }

  return tr.steps.length > 0 ? tr : null
}
