import type { ImageNode } from '../../model/types'
import { type XNode, tagOf, childrenOf, attr, intAttr, findChild, buildXml } from '../xml'

/**
 * w:drawing を読む。
 *
 * 構造は深い:
 *   w:drawing
 *     wp:inline (行内) または wp:anchor (浮動)
 *       wp:extent cx cy          ← 表示サイズ (EMU)
 *       wp:docPr name descr      ← 代替テキスト
 *       a:graphic/a:graphicData/pic:pic
 *         pic:blipFill/a:blip r:embed  ← 画像パートへの関係 ID
 *
 * 認識できない図形 (グラフ・SmartArt・ワードアート) は画像ではないので、
 * ここでは null を返して呼び出し側に raw 退避させる。勝手に絵に潰さない。
 */
export function readDrawing(
  drawing: XNode,
  resolveMedia: (relId: string) => string | null
): ImageNode | null {
  const container = findChild(drawing, 'wp:inline') ?? findChild(drawing, 'wp:anchor')
  if (!container) return null
  const inline = tagOf(container) === 'wp:inline'

  const blip = findDescendant(container, 'a:blip')
  const relId = blip ? (attr(blip, 'r:embed') ?? attr(blip, 'r:link')) : null
  if (!relId) return null

  const mediaKey = resolveMedia(relId)
  if (!mediaKey) return null

  const extent = findChild(container, 'wp:extent')
  const docPr = findChild(container, 'wp:docPr')

  return {
    type: 'image',
    attrs: {
      mediaKey,
      relId,
      cx: intAttr(extent, 'cx') ?? 0,
      cy: intAttr(extent, 'cy') ?? 0,
      wrap: inline ? 'inline' : wrapOf(container),
      name: attr(docPr, 'name') ?? '',
      descr: attr(docPr, 'descr') ?? '',
      inline,
      // 回り込みや効果など、モデル化しきれない指定は原文ごと保持する。
      // 書き出しではこちらを優先して書き戻す
      rawDrawing: buildXml([drawing])
    }
  }
}

/** wp:anchor の回り込み指定 */
function wrapOf(anchor: XNode): ImageNode['attrs']['wrap'] {
  for (const child of childrenOf(anchor)) {
    switch (tagOf(child)) {
      case 'wp:wrapSquare':
        return 'square'
      case 'wp:wrapTight':
      case 'wp:wrapThrough':
        return 'tight'
      case 'wp:wrapTopAndBottom':
        return 'topAndBottom'
      case 'wp:wrapNone':
        // behindDoc で前面か背面かが決まる
        return attr(anchor, 'behindDoc') === '1' ? 'behind' : 'inFront'
    }
  }
  return 'square'
}

/** 名前空間をまたぐ深い入れ子から要素を探す */
function findDescendant(node: XNode, tag: string): XNode | undefined {
  for (const child of childrenOf(node)) {
    if (tagOf(child) === tag) return child
    const found = findDescendant(child, tag)
    if (found) return found
  }
  return undefined
}
