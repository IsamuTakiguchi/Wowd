import { describe, it, expect } from 'vitest'
import { imageWrapStyle } from '@core/css/imageCss'
import type { ImageNode } from '@core/model/types'

/**
 * 画像の回り込み。
 *
 * これまで wrap の値は読み取って保持するだけで、**描画は常に inline** だった。
 * Word で文字が回り込んでいる文書を開くと、画像が行の中に押し込まれて
 * 見た目が大きく変わっていた。
 *
 * 画面と PDF で同じ関数を使う。別々に書くと
 * 「画面では合っているのに PDF がずれる」になる。
 */
const attrs = (patch: Partial<ImageNode['attrs']>): ImageNode['attrs'] => ({
  mediaKey: 'm1',
  relId: 'rId1',
  cx: 914400,
  cy: 914400,
  wrap: 'inline',
  align: null,
  name: '',
  descr: '',
  inline: true,
  rawDrawing: null,
  ...patch
})

describe('回り込みの写し方', () => {
  it('行内配置には何も足さない', () => {
    expect(imageWrapStyle(attrs({ wrap: 'inline' }))).toBe('')
  })

  it('四角で囲む配置は float になる', () => {
    expect(imageWrapStyle(attrs({ wrap: 'square', align: 'left' }))).toContain('float:left')
    expect(imageWrapStyle(attrs({ wrap: 'square', align: 'right' }))).toContain('float:right')
    // 指定が無いときは左。Word の既定に合わせる
    expect(imageWrapStyle(attrs({ wrap: 'square', align: null }))).toContain('float:left')
  })

  it('外周に沿う配置も float として扱う', () => {
    // 多角形に沿わせるのは CSS では表せない。四角と同じ扱いにする
    expect(imageWrapStyle(attrs({ wrap: 'tight', align: 'right' }))).toContain('float:right')
  })

  it('上下配置は行を占める', () => {
    const style = imageWrapStyle(attrs({ wrap: 'topAndBottom' }))
    expect(style).toContain('display:block')
    expect(style).toContain('clear:both')
    expect(style).not.toContain('float')
  })

  it('中央寄せは float にしない', () => {
    // float:left と中央寄せは両立しない
    const style = imageWrapStyle(attrs({ wrap: 'square', align: 'center' }))
    expect(style).toContain('margin:0.5em auto')
    expect(style).not.toContain('float')
  })

  it('本文の裏表に置くものは流れに残す', () => {
    // 位置の基準と座標を CSS の absolute に写すと、かえってずれる。
    // ずれてはいても、どこにあるかは分かる状態にしておく
    expect(imageWrapStyle(attrs({ wrap: 'behind' }))).toBe('')
    expect(imageWrapStyle(attrs({ wrap: 'inFront' }))).toBe('')
  })
})
