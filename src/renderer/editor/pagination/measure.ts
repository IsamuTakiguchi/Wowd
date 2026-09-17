/**
 * 本文ブロックの実測。
 *
 * 肝は「スペーサーを除いた本来の高さ」を取ること。
 * スペーサーは自分で挿し込んだ widget なので高さが分かる。
 * 各ブロックの offsetTop から、それより前にあるスペーサーの合計を引けば
 * 本来の位置が出る。この差分から高さを求めると、
 * margin の相殺も含めて実際のレイアウトどおりの値になる。
 *
 * 高さを直接 getBoundingClientRect で取らないのはそのため
 * (margin が含まれず、段落間の余白が消える)。
 */

export interface BlockMetrics {
  /** スペーサーを除いた、本文先頭からの位置 (px) */
  top: number
  /** 次のブロックまでの距離 = margin 込みの実効高 (px) */
  height: number
  /** ProseMirror 文書内の位置 */
  pos: number
  /** 実測に使った DOM 要素 */
  el: HTMLElement
}

export const SPACER_ATTRIBUTE = 'data-wowd-spacer'

/**
 * 本文の直下の子要素を走査して実効高を測る。
 *
 * DOM 読み取りは 1 回のパスにまとめる。読み書きを交互にすると
 * レイアウトが毎回再計算されて極端に遅くなる。
 */
export function measureBlocks(
  flow: HTMLElement,
  posOf: (el: HTMLElement) => number | null
): BlockMetrics[] {
  const children = Array.from(flow.children) as HTMLElement[]

  // 読み取りフェーズ: ここでは一切 DOM を変更しない
  const raw: { el: HTMLElement; offsetTop: number; height: number; isSpacer: boolean }[] = []
  for (const el of children) {
    raw.push({
      el,
      offsetTop: el.offsetTop,
      height: el.offsetHeight,
      isSpacer: el.hasAttribute(SPACER_ATTRIBUTE)
    })
  }

  // 各要素より前にあるスペーサーの累積を引いて本来の位置に戻す
  const blocks: BlockMetrics[] = []
  const ownHeights: number[] = []
  let spacerSum = 0
  for (const item of raw) {
    if (item.isSpacer) {
      spacerSum += item.height
      continue
    }
    const pos = posOf(item.el)
    if (pos === null) continue
    blocks.push({
      top: item.offsetTop - spacerSum,
      height: 0, // 次のブロックとの差分で埋める
      pos,
      el: item.el
    })
    ownHeights.push(item.height)
  }

  for (let i = 0; i < blocks.length; i++) {
    const current = blocks[i]!
    const next = blocks[i + 1]
    // 次のブロックとの差分なら margin も含まれる。
    // 最後のブロックだけは差分が取れないので自身の高さを使う
    current.height = next ? next.top - current.top : (ownHeights[i] ?? 0)
    // margin の相殺や丸めで負になることがある。0 未満は意味を持たない
    if (current.height < 0) current.height = 0
  }

  return blocks
}
