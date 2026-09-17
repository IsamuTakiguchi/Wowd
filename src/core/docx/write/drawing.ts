import type { ImageNode } from '../../model/types'
import { el, wrap } from '../xml'

/**
 * w:drawing を組み立てる。
 *
 * 読み込んだ画像は原文 (rawDrawing) をそのまま書き戻すので、ここを通るのは
 * このアプリで挿入した画像だけ。回り込みも効果も持たない素の行内画像なので、
 * Word が必要とする最小限の骨格だけを作る。
 *
 * 名前空間はすべてこの中で宣言する。documentRootAttrs は元文書の
 * ルート宣言をそのまま使い回すので、図形を含んだことのない文書には
 * wp: や a: の宣言が無いことがある。未宣言の接頭辞を含む XML は
 * 整形式ですらないので、Word は開くことすらできない。
 */

const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'

/** wp:docPr の id。Word は 0 を嫌うので 1 以上にする */
function docPrId(mediaKey: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < mediaKey.length; i++) {
    hash ^= mediaKey.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  // 大きすぎる値も避ける。Word の実装は 32bit 符号つきで扱う
  return (hash % 0x7ffffffe) + 1
}

export function writeDrawing(node: ImageNode): string {
  const a = node.attrs
  if (!a.relId) return ''

  const cx = Math.max(1, Math.round(a.cx))
  const cy = Math.max(1, Math.round(a.cy))
  const name = a.name || 'image'

  const blipFill = wrap(
    'pic:blipFill',
    undefined,
    el('a:blip', { 'r:embed': a.relId }) +
      wrap('a:stretch', undefined, el('a:fillRect'))
  )

  const spPr = wrap(
    'pic:spPr',
    undefined,
    wrap('a:xfrm', undefined, el('a:off', { x: 0, y: 0 }) + el('a:ext', { cx, cy })) +
      wrap('a:prstGeom', { prst: 'rect' }, el('a:avLst'))
  )

  const pic = wrap(
    'pic:pic',
    { 'xmlns:pic': PIC_NS },
    wrap(
      'pic:nvPicPr',
      undefined,
      el('pic:cNvPr', { id: 0, name }) + el('pic:cNvPicPr')
    ) +
      blipFill +
      spPr
  )

  const graphic = wrap(
    'a:graphic',
    { 'xmlns:a': A_NS },
    wrap('a:graphicData', { uri: PIC_NS }, pic)
  )

  const inline = wrap(
    'wp:inline',
    { 'xmlns:wp': WP_NS, distT: 0, distB: 0, distL: 0, distR: 0 },
    el('wp:extent', { cx, cy }) +
      el('wp:effectExtent', { l: 0, t: 0, r: 0, b: 0 }) +
      el('wp:docPr', {
        id: docPrId(a.mediaKey),
        name,
        descr: a.descr || undefined
      }) +
      wrap(
        'wp:cNvGraphicFramePr',
        undefined,
        el('a:graphicFrameLocks', { 'xmlns:a': A_NS, noChangeAspect: 1 })
      ) +
      graphic
  )

  return wrap('w:r', undefined, wrap('w:drawing', undefined, inline))
}
