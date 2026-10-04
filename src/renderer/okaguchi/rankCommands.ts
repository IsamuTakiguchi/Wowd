/**
 * 岡口マクロの「ランクN」「打直」の段落操作。ProseMirror の取引 (transaction) だけで書く。
 *
 * 元のマクロは選択位置を整数で持ち直して戻すため、文字を消すと位置がずれる不具合があった
 * (仕様 §8.2 の 2・3)。ここでは位置の対応付け (mapping) に任せるので、ずれない。
 */
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { RankStyleIds } from '@core/okaguchi/rank'

const FULL_SPACE = '\u3000'

export interface RankOptions {
  /** 打直。トグルせず常にランクにし、この numPr で番号を振り直す */
  restartNumPr?: { numId: number; ilvl: number } | null
}

/** 段落の先頭の 1 文字 (テキストでなければ null) */
function firstChar(node: PMNode): string | null {
  const first = node.firstChild
  if (!first?.isText) return null
  return first.text?.[0] ?? null
}

/** 選択範囲にかかる段落 (文書順) */
function selectedTextblocks(state: EditorState): number[] {
  const { from, to } = state.selection
  const positions: number[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      positions.push(pos)
      return false
    }
    return true
  })
  return positions
}

/**
 * 段落にスタイルを当てる。
 *
 * Word で段落スタイルを当てたときと同じく、段落の直接指定のうち
 * スタイルが決める項目 (インデント・配置・番号・アウトライン) は外す。
 * 残すと、ランクのインデントや番号がスタイルどおりに出ない。
 */
function setParagraphStyle(
  tr: Transaction,
  pos: number,
  styleId: string,
  numPr: { numId: number; ilvl: number } | null
): void {
  const node = tr.doc.nodeAt(pos)
  if (!node) return
  const paragraph = tr.doc.type.schema.nodes['paragraph']
  const type = node.type.name === 'heading' && paragraph ? paragraph : node.type
  const attrs: Record<string, unknown> = { ...node.attrs, pStyle: styleId, numPr, ind: null, jc: null }
  if ('outlineLvl' in node.attrs) attrs['outlineLvl'] = null
  // 見出しノードにしか無い属性は落とす
  if (type !== node.type) delete attrs['level']
  tr.setNodeMarkup(pos, type, type.create(attrs).attrs)
}

/**
 * ランクN (Alt+N) / 打直 (Alt+Shift+N)。
 *
 * 1 段落目: ランクN ⇔ 本文N で切り替える (打直は常にランクN)。
 *   ランクにするとき、先頭に全角スペースを 1 つ置く (半角 1 つは全角に置き換える)。
 *   本文に戻すとき、先頭の全角スペースを消す (ランク６だけは半角も消す)。
 * 2 段落目以降: 必ず本文N。元がランクだった段落だけ、先頭の空白を 2 つまで消す。
 *
 * 番号は本文の文字には入れない。スタイルに結び付けた番号定義が描く。
 *
 * @returns 何もしなかったら null
 */
export function rankTransaction(
  state: EditorState,
  n: number,
  ids: RankStyleIds,
  options: RankOptions = {}
): Transaction | null {
  const positions = selectedTextblocks(state)
  if (positions.length === 0) return null
  const rankId = ids.rank[n]
  const bodyId = ids.body[n]
  if (!rankId || !bodyId) return null
  const rankIds = new Set(ids.rank.slice(1))

  const tr = state.tr
  positions.forEach((original, i) => {
    const pos = tr.mapping.map(original)
    const node = tr.doc.nodeAt(pos)
    if (!node) return
    const start = pos + 1
    const head = firstChar(node)

    if (i === 0) {
      const toBody = options.restartNumPr === undefined && node.attrs['pStyle'] === rankId
      if (toBody) {
        setParagraphStyle(tr, pos, bodyId, null)
        if (head === FULL_SPACE || (n === 6 && head === ' ')) tr.delete(start, start + 1)
        return
      }
      setParagraphStyle(tr, pos, rankId, options.restartNumPr ?? null)
      if (head === ' ' || head === FULL_SPACE) {
        if (head === ' ') tr.insertText(FULL_SPACE, start, start + 1)
      } else {
        tr.insertText(FULL_SPACE, start)
      }
      return
    }

    const wasRank = rankIds.has(node.attrs['pStyle'] as string)
    setParagraphStyle(tr, pos, bodyId, null)
    if (!wasRank) return
    for (let k = 0; k < 2; k++) {
      const current = tr.doc.nodeAt(pos)
      const c = current ? firstChar(current) : null
      if (c !== ' ' && c !== FULL_SPACE) break
      tr.delete(start, start + 1)
    }
  })

  return tr.docChanged ? tr : null
}

/** 文書中の段落 (表の中も文書順) の位置と、番号に関わる属性 */
export function collectParagraphs(
  doc: PMNode
): { pos: number; numPr: { numId: number; ilvl: number } | null; pStyle: string | null }[] {
  const out: { pos: number; numPr: { numId: number; ilvl: number } | null; pStyle: string | null }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    out.push({
      pos,
      numPr: (node.attrs['numPr'] as { numId: number; ilvl: number } | null) ?? null,
      pStyle: (node.attrs['pStyle'] as string | null) ?? null
    })
    return false
  })
  return out
}

/** 段落の numPr だけを書き換える取引 */
export function setNumPrTransaction(
  state: EditorState,
  changes: Map<number, { numId: number; ilvl: number } | null>
): Transaction | null {
  if (changes.size === 0) return null
  const tr = state.tr
  for (const [pos, numPr] of changes) {
    const node = tr.doc.nodeAt(pos)
    if (!node) continue
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, numPr })
  }
  return tr
}
