/**
 * 改ページ位置の決定。
 *
 * 実測した「本来の高さ」の列だけを受け取る純粋関数にしてある。
 * DOM を触らないので単体テストで挙動を固定でき、
 * ページ分割の規則を実測の都合と切り離して検証できる。
 */

export interface BlockInput {
  /** margin 込みの実効高 (px) */
  height: number
  /** この段落の前で必ず改ページする (w:pageBreakBefore、または改ページノード) */
  breakBefore: boolean
  /** 次の段落と同じページに置く (w:keepNext)。見出しが独り残りするのを防ぐ */
  keepNext: boolean
}

export interface ComputedBreak {
  /** breaks[i] = true なら、i 番目のブロックの直前で改ページする */
  index: number
  /** 現在のページに残っていた空き (px)。スペーサーの高さ計算に使う */
  remaining: number
}

export interface BreakOptions {
  /** 1 ページの本文領域の高さ (px) */
  pageContentHeight: number
}

/**
 * ブロック列から改ページ位置を求める。
 *
 * 規則:
 *   1. breakBefore は無条件に改ページする (先頭ブロックを除く)
 *   2. ページに収まらないブロックは次ページへ送る
 *   3. keepNext が連なるブロック群は、可能なら同じページに送る
 *   4. 1 ページに収まらない巨大なブロックは、送っても収まらないので
 *      そのページに置いて溢れさせる (無限に改ページしないため)
 */
export function computeBreaks(blocks: BlockInput[], options: BreakOptions): ComputedBreak[] {
  const { pageContentHeight } = options
  if (pageContentHeight <= 0) return []

  const breaks: ComputedBreak[] = []
  let used = 0

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!

    if (i > 0 && block.breakBefore) {
      breaks.push({ index: i, remaining: pageContentHeight - used })
      used = block.height
      continue
    }

    // keepNext で連なる塊はまとめて送らないと見出しだけが取り残される
    const groupHeight = keepNextGroupHeight(blocks, i)

    if (used > 0 && used + groupHeight > pageContentHeight) {
      // 送っても収まらない塊なら送るだけ無駄。いまのページに置く
      if (groupHeight <= pageContentHeight || used + block.height > pageContentHeight) {
        breaks.push({ index: i, remaining: pageContentHeight - used })
        used = 0
      }
    }

    used += block.height

    // 1 ページより高いブロックは、その先頭からページを数え直す
    if (used > pageContentHeight) {
      used = ((used - 1) % pageContentHeight) + 1
    }
  }

  return breaks
}

/** i から始まる keepNext の連なり全体の高さ */
function keepNextGroupHeight(blocks: BlockInput[], i: number): number {
  let total = 0
  let j = i
  // 連鎖が長すぎると 1 ページに収まらないので上限を設ける
  const limit = Math.min(blocks.length, i + 8)
  while (j < limit) {
    const block = blocks[j]!
    total += block.height
    if (!block.keepNext) break
    j++
    if (j < blocks.length && blocks[j]!.breakBefore) break
  }
  return total
}

/**
 * 改ページ位置からスペーサーの高さを求める。
 *
 * スペーサーは「ページ下端までの余り」＋「下余白」＋「隙間」＋「上余白」。
 * これで次のブロックがちょうど次ページの本文領域の先頭に来る。
 */
export function spacerHeight(
  remaining: number,
  marginAfter: number,
  marginBefore: number,
  gap: number
): number {
  return Math.max(0, remaining) + marginAfter + gap + marginBefore
}

/**
 * 1 ページに収まらないブロックの番号を返す。
 *
 * 規則 4 で「そのページに置いて溢れさせる」対象そのもの。
 * 溢れること自体は無限ループを避けるための正しい振る舞いだが、
 * **利用者から見ると紙からはみ出して見える。**
 * 表はページ間で分割しないので、長い表でこれが起きる。
 *
 * 黙って溢れさせると「Wowd が表を壊した」と受け取られる。
 * 知らせるために、ここで数えられるようにしておく。
 */
export function overflowingBlocks(blocks: BlockInput[], options: BreakOptions): number[] {
  const { pageContentHeight } = options
  if (pageContentHeight <= 0) return []
  const out: number[] = []
  for (let i = 0; i < blocks.length; i++) {
    if ((blocks[i]?.height ?? 0) > pageContentHeight) out.push(i)
  }
  return out
}
