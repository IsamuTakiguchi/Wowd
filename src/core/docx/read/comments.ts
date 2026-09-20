import type { CommentRecord, WowdDoc } from '../../model/types'
import { parseXml, tagOf, childrenOf, attr } from '../xml'
import type { RunContext } from './run'
import { readBody } from './body'

/**
 * comments.xml と commentsExtended.xml を読む。
 *
 * コメント本文は小さな文書 (段落の並び) なので、本文と同じ読み方をする。
 * スレッドの親子関係は commentsExtended.xml にあり、
 * w14:paraId で結び付けられている。この ID を失うと Word 側で
 * 返信関係が壊れるので、段落の paraId は必ず保持する。
 */
export function readComments(
  commentsXml: string | null,
  extendedXml: string | null,
  ctx: RunContext
): Map<string, CommentRecord> {
  const out = new Map<string, CommentRecord>()
  if (!commentsXml) return out

  const root = parseXml(commentsXml).find((n) => tagOf(n) === 'w:comments')
  if (!root) return out

  /** コメント末尾の段落 paraId → コメント ID。スレッド解決に使う */
  const paraIdToComment = new Map<string, string>()

  for (const node of childrenOf(root)) {
    if (tagOf(node) !== 'w:comment') continue
    const id = attr(node, 'w:id')
    if (!id) continue

    // コメント本文は w:p の並び。本文と同じ経路で読む
    const { blocks } = readBody(node, ctx)
    const body: WowdDoc = { type: 'doc', content: blocks }

    for (const block of blocks) {
      if (block.type === 'paragraph' && block.attrs.paraId) {
        paraIdToComment.set(block.attrs.paraId, id)
      }
    }

    out.set(id, {
      id,
      author: attr(node, 'w:author') ?? '',
      initials: attr(node, 'w:initials') ?? '',
      date: attr(node, 'w:date') ?? '',
      body,
      parentId: null,
      done: false,
      // 本文を読んだあとに read/index.ts が差し込む
      refRPr: null
    })
  }

  applyExtended(out, paraIdToComment, extendedXml)
  return out
}

/**
 * commentsExtended.xml からスレッドと解決状態を反映する。
 *
 * ここでは w15:paraId が「そのコメントの末尾段落」を、
 * w15:paraIdParent が「返信先コメントの末尾段落」を指す。
 */
function applyExtended(
  comments: Map<string, CommentRecord>,
  paraIdToComment: Map<string, string>,
  extendedXml: string | null
): void {
  if (!extendedXml) return
  const root = parseXml(extendedXml).find((n) => tagOf(n) === 'w15:commentsEx')
  if (!root) return

  for (const node of childrenOf(root)) {
    if (tagOf(node) !== 'w15:commentEx') continue
    const paraId = attr(node, 'w15:paraId')
    if (!paraId) continue
    const commentId = paraIdToComment.get(paraId)
    if (!commentId) continue
    const record = comments.get(commentId)
    if (!record) continue

    const parentParaId = attr(node, 'w15:paraIdParent')
    if (parentParaId) {
      record.parentId = paraIdToComment.get(parentParaId) ?? null
    }
    const done = attr(node, 'w15:done')
    record.done = done === '1' || done === 'true'
  }
}

/** コメントの並びをスレッドにまとめる。親が先、返信が続く */
export function threadComments(comments: Map<string, CommentRecord>): CommentRecord[][] {
  const roots: CommentRecord[] = []
  const replies = new Map<string, CommentRecord[]>()

  for (const comment of comments.values()) {
    if (comment.parentId && comments.has(comment.parentId)) {
      const list = replies.get(comment.parentId) ?? []
      list.push(comment)
      replies.set(comment.parentId, list)
    } else {
      roots.push(comment)
    }
  }

  const byDate = (a: CommentRecord, b: CommentRecord): number => a.date.localeCompare(b.date)
  roots.sort(byDate)

  return roots.map((root) => [root, ...(replies.get(root.id) ?? []).sort(byDate)])
}

/** 既存と衝突しないコメント ID を発番する */
export function nextCommentId(comments: Map<string, CommentRecord>): string {
  let max = -1
  for (const id of comments.keys()) {
    const n = Number(id)
    if (Number.isFinite(n)) max = Math.max(max, n)
  }
  return String(max + 1)
}

/** 段落の識別子 (w14:paraId) を発番する。8 桁の 16 進で 0 は使えない */
export function newParaId(): string {
  const value = Math.floor(Math.random() * 0x7fffffff) + 1
  return value.toString(16).toUpperCase().padStart(8, '0')
}
