import { describe, expect, test } from 'vitest'
import {
  trimMarkLayout,
  trimMarkPaperMm,
  trimMarkSvg,
  DEFAULT_BLEED_MM,
  DEFAULT_MARK_LENGTH_MM
} from '@core/layout/trimMarks'
import { mmToTwip, twipToMm } from '../../src/shared/units'

/** A5 (148 x 210mm) を仕上がりサイズとして使う。同人誌や書籍でよく使う判 */
const A5 = { finishInline: mmToTwip(148), finishBlock: mmToTwip(210) }

describe('裁ちトンボ', () => {
  // mm で比べるときは小数 1 桁まで。twip は約 0.018mm 刻みなので、
  // mm ちょうどの値は twip に丸めた時点で必ず端数が出る。
  // 断裁の精度は ±1mm 程度なので、この差は実害にならない
  test('用紙は仕上がりサイズの四辺に 塗り足し + 線の長さ を足した大きさになる', () => {
    const layout = trimMarkLayout(A5)
    const margin = mmToTwip(DEFAULT_BLEED_MM) + mmToTwip(DEFAULT_MARK_LENGTH_MM)
    // twip では端数無く一致する
    expect(layout.offset).toBe(margin)
    expect(layout.sheetInline).toBe(A5.finishInline + margin * 2)
    expect(layout.sheetBlock).toBe(A5.finishBlock + margin * 2)
    // 人が読む値としても合っている
    expect(twipToMm(layout.sheetInline)).toBeCloseTo(148 + 13 * 2, 1)
    expect(twipToMm(layout.sheetBlock)).toBeCloseTo(210 + 13 * 2, 1)
  })

  test('仕上がり領域は用紙の中央に来る', () => {
    const layout = trimMarkLayout(A5)
    const left = layout.offset
    const right = layout.sheetInline - (layout.offset + A5.finishInline)
    expect(left).toBe(right)
    const top = layout.offset
    const bottom = layout.sheetBlock - (layout.offset + A5.finishBlock)
    expect(top).toBe(bottom)
  })

  test('線はすべて水平か垂直で、用紙の外にはみ出さない', () => {
    const layout = trimMarkLayout(A5)
    expect(layout.lines.length).toBeGreaterThan(0)
    for (const l of layout.lines) {
      expect(l.x1 === l.x2 || l.y1 === l.y2).toBe(true)
      for (const x of [l.x1, l.x2]) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(layout.sheetInline)
      }
      for (const y of [l.y1, l.y2]) {
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(layout.sheetBlock)
      }
    }
  })

  /**
   * ここが裁ちトンボの肝。
   * 内側の線を仕上がりの角まで引いてしまうと、断ち切れずに残ったとき製品に線が出る。
   */
  test('角トンボの線は仕上がりの角に届かず、塗り足しぶん手前で止まる', () => {
    const layout = trimMarkLayout(A5)
    const trimLeft = layout.offset
    const trimTop = layout.offset

    // 左上の、仕上がり線と同じ高さの水平線
    const topTrimLine = layout.lines.find(
      (l) => l.y1 === l.y2 && l.y1 === trimTop && l.x1 === 0
    )
    expect(topTrimLine, '左上の水平な内トンボが無い').toBeDefined()
    // 角 (trimLeft) には届かず、塗り足し線で止まっている
    expect(topTrimLine?.x2).toBe(trimLeft - layout.bleed)
    expect(twipToMm((topTrimLine as { x2: number }).x2 - 0)).toBeCloseTo(DEFAULT_MARK_LENGTH_MM, 1)
  })

  test('四隅すべてに二重のカギ線がある (水平 2 本 + 垂直 2 本 x 4 隅)', () => {
    const layout = trimMarkLayout({ ...A5, center: false })
    // 角トンボだけなら 16 本
    expect(layout.lines).toHaveLength(16)
  })

  test('センタートンボは各辺の中央に十字で入る', () => {
    const withCenter = trimMarkLayout(A5)
    const withoutCenter = trimMarkLayout({ ...A5, center: false })
    // 4 辺 x (垂直な線 + 直交する線) = 8 本増える
    expect(withCenter.lines.length - withoutCenter.lines.length).toBe(8)

    const midX = withCenter.offset + A5.finishInline / 2
    const topCenter = withCenter.lines.find((l) => l.x1 === l.x2 && l.x1 === midX && l.y1 === 0)
    expect(topCenter, '上辺のセンタートンボが無い').toBeDefined()
  })

  test('塗り足しと線の長さを変えられる', () => {
    const layout = trimMarkLayout({ ...A5, bleed: mmToTwip(5), markLength: mmToTwip(15) })
    expect(layout.offset).toBe(mmToTwip(5) + mmToTwip(15))
    expect(layout.bleed).toBe(mmToTwip(5))
    expect(twipToMm(layout.offset)).toBeCloseTo(20, 1)
  })

  test('印刷に渡す用紙サイズを mm で取れる', () => {
    const paper = trimMarkPaperMm(trimMarkLayout(A5))
    expect(paper.widthMm).toBeCloseTo(174, 1)
    expect(paper.heightMm).toBeCloseTo(236, 1)
    // 仕上がりより必ず大きい。ここが逆転すると印刷でトンボが切れる
    expect(paper.widthMm).toBeGreaterThan(148)
    expect(paper.heightMm).toBeGreaterThan(210)
  })

  describe('SVG', () => {
    test('viewBox は用紙全体で、指定した幅と高さがそのまま入る', () => {
      const layout = trimMarkLayout(A5)
      const svg = trimMarkSvg(layout, { width: '174mm', height: '236mm' })
      expect(svg).toContain('width="174mm"')
      expect(svg).toContain('height="236mm"')
      expect(svg).toContain(`viewBox="0 0 ${Math.round(layout.sheetInline * 100) / 100}`)
    })

    test('線の数だけ移動と描画の組がある', () => {
      const layout = trimMarkLayout(A5)
      const svg = trimMarkSvg(layout, { width: '10px', height: '10px' })
      expect((svg.match(/M/g) ?? []).length).toBe(layout.lines.length)
      expect((svg.match(/L/g) ?? []).length).toBe(layout.lines.length)
    })

    test('読み上げの対象にしない (装飾なので)', () => {
      const svg = trimMarkSvg(trimMarkLayout(A5), { width: '1px', height: '1px' })
      expect(svg).toContain('aria-hidden="true"')
    })
  })
})
