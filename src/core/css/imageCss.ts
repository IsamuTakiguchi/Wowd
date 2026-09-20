import type { ImageNode } from '../model/types'

/**
 * 画像の回り込みを CSS に写す。
 *
 * 画面と PDF の両方で同じものを使う。片方だけ直すと見た目が食い違い、
 * 「画面では合っているのに PDF がずれる」という報告になる。
 *
 * ## 写せるもの
 *
 * - square / tight / through … float。左右は wp:positionH の指定で決める
 * - topAndBottom … 上下に文字を流す = 行を占める block
 *
 * ## 写さないもの
 *
 * - behind / inFront … 座標で本文の裏表に置くもの。
 *   位置の基準 (段落・余白・ページ) と実際の座標が要るが、
 *   それを CSS の absolute にそのまま写すと**かえってずれる**。
 *   行の流れに置いたままにする。ずれてはいるが、どこにあるかは分かる。
 *
 * 回り込みは float なので、**段落の外へはみ出す**。Word も同じで、
 * 次の段落の文字がその横に回り込む。ページ分割は offsetTop の差分で
 * 測っているので、はみ出しても位置がずれることはない。
 */
export function imageWrapStyle(attrs: ImageNode['attrs']): string {
  switch (attrs.wrap) {
    case 'square':
    case 'tight':
      return attrs.align === 'right'
        ? 'float:right;margin:0 0 0.5em 0.5em'
        : attrs.align === 'center'
          ? 'display:block;margin:0.5em auto'
          : 'float:left;margin:0 0.5em 0.5em 0'
    case 'topAndBottom':
      return attrs.align === 'center'
        ? 'display:block;clear:both;margin:0.5em auto'
        : attrs.align === 'right'
          ? 'display:block;clear:both;margin:0.5em 0 0.5em auto'
          : 'display:block;clear:both;margin:0.5em 0'
    default:
      return ''
  }
}
