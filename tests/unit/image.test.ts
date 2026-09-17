import { describe, it, expect } from 'vitest'
import { fitSize, nextMediaKey, textWidthEmu } from '@renderer/editor/commands/image'
import { emuToPt } from '@shared/units'
import type { MediaEntry } from '@core/model/types'

/** A4 縦・上下左右 1 インチのときの本文幅 */
const A4_TEXT_WIDTH = textWidthEmu(11906, 1440, 1440)

describe('挿入する画像の寸法', () => {
  it('96dpi として点に直す', () => {
    // 96px = 1 インチ = 72pt
    const { cx, cy } = fitSize(96, 48, A4_TEXT_WIDTH)
    expect(emuToPt(cx)).toBeCloseTo(72, 1)
    expect(emuToPt(cy)).toBeCloseTo(36, 1)
  })

  it('本文の幅を超える画像は縦横比を保って縮める', () => {
    const { cx, cy } = fitSize(4000, 2000, A4_TEXT_WIDTH)
    expect(cx).toBe(A4_TEXT_WIDTH)
    // 2:1 の比が保たれている
    expect(cy / cx).toBeCloseTo(0.5, 2)
  })

  it('本文に収まる画像はそのままの寸法で置く', () => {
    const { cx } = fitSize(100, 100, A4_TEXT_WIDTH)
    expect(cx).toBeLessThan(A4_TEXT_WIDTH)
    expect(emuToPt(cx)).toBeCloseTo(75, 1)
  })

  it('寸法が分からない画像でも本文からはみ出さない', () => {
    const { cx, cy } = fitSize(null, null, A4_TEXT_WIDTH)
    expect(cx).toBeGreaterThan(0)
    expect(cy).toBeGreaterThan(0)
    expect(cx).toBeLessThanOrEqual(A4_TEXT_WIDTH)
  })

  it('本文の幅は極端に狭い余白設定でも下限を割らない', () => {
    // 余白が用紙より広いという壊れた設定でも 1 インチは確保する
    expect(textWidthEmu(11906, 9000, 9000)).toBe(textWidthEmu(11906, 0, 10466))
  })
})

describe('画像のパート名', () => {
  const media = (...keys: string[]): Map<string, MediaEntry> =>
    new Map(keys.map((k) => [k, { bytes: new Uint8Array(1), contentType: 'image/png' }]))

  it('既存と衝突しない名前を選ぶ', () => {
    expect(nextMediaKey(media(), 'png')).toBe('word/media/image1.png')
    expect(nextMediaKey(media('word/media/image1.png'), 'png')).toBe('word/media/image2.png')
  })

  it('拡張子は小文字にし、点があっても受ける', () => {
    expect(nextMediaKey(media(), '.JPEG')).toBe('word/media/image1.jpeg')
  })

  it('拡張子が空なら png にする', () => {
    expect(nextMediaKey(media(), '')).toBe('word/media/image1.png')
  })

  it('同じ番号でも拡張子が違えば別のパートになる', () => {
    expect(nextMediaKey(media('word/media/image1.png'), 'jpg')).toBe('word/media/image1.jpg')
  })
})
