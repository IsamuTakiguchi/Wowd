import type { Editor } from '@tiptap/react'
import { collectHeadings, applyToc, findExistingToc } from '@core/toc'
import { toWowdDoc } from '../serialize/toWowdDoc'
import { fromWowdDoc } from '../serialize/fromWowdDoc'
import { paginationKey } from '../pagination/PaginationPlugin'

/**
 * 目次を挿入または更新する。
 *
 * ページ番号はページ分割の結果から取る。分からなければ空にして
 * フィールドに dirty を立て、Word 側で再計算させる。
 * こちらの行分割は Word と完全には一致しないので、
 * 数字を断定するより Word に計算させる方が正しい。
 */
export function insertOrUpdateToc(editor: Editor, minLevel = 1, maxLevel = 3): number {
  const doc = toWowdDoc(editor.getJSON() as never)
  const pageOf = buildPageLookup(editor)
  const entries = collectHeadings(doc, { minLevel, maxLevel, pageOf })

  // 目次がまだ無ければカーソル位置の段落の手前に入れる
  const existing = findExistingToc(doc)
  const insertAt = existing ? existing[0] : currentBlockIndex(editor)

  const next = applyToc(doc, entries, insertAt, minLevel, maxLevel)
  editor.chain().focus().setContent(fromWowdDoc(next) as never).run()
  return entries.length
}

export function hasToc(editor: Editor): boolean {
  return findExistingToc(toWowdDoc(editor.getJSON() as never)) !== null
}

/** カーソルがある最上位ブロックの番号 */
function currentBlockIndex(editor: Editor): number {
  try {
    return editor.state.selection.$from.index(0)
  } catch {
    return 0
  }
}

/**
 * ブロック番号 → ページ番号。
 * ページ分割プラグインが差し込んだスペーサーの位置から求める。
 */
function buildPageLookup(editor: Editor): (blockIndex: number) => number | null {
  const state = paginationKey.getState(editor.state)
  if (!state || state.decorations.find().length === 0) return () => null

  const breakIndices: number[] = []
  for (const decoration of state.decorations.find()) {
    try {
      breakIndices.push(editor.state.doc.resolve(decoration.from).index(0))
    } catch {
      // 解決できない位置は飛ばす
    }
  }
  breakIndices.sort((a, b) => a - b)

  return (blockIndex: number) => {
    let page = 1
    for (const at of breakIndices) {
      if (blockIndex >= at) page++
      else break
    }
    return page
  }
}
