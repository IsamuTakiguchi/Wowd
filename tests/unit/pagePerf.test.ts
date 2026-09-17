import { describe, it, expect } from 'vitest'
import { computeBreaks, type BlockInput } from '@core/layout/pageBreaks'

/**
 * ページ分割の計算量。
 *
 * ページ分割は「打鍵のたびに O(文書長)」になりやすく、
 * そうなると長い文書で製品として使いものにならなくなる。
 * 壊れても画面は正しく出るので、見た目では気づけない。
 *
 * ここで測るのは純粋関数 (computeBreaks) だけにしてある。
 * E2E に時間の assert を置くと CI の負荷で簡単に揺れて、
 * 「たまに落ちるテスト」になって無視されるようになるため。
 *
 * 予算は実測の 10 倍以上に取ってある。狙いは「遅くなったこと」ではなく
 * **「計算量の桁が変わったこと」**を捕まえること。
 */

/** A4 の本文領域の高さ (px 相当) */
const PAGE_HEIGHT = 900

/** 1 行 ≒ 24px。1 ページ ≒ 37 ブロック */
function blocks(count: number, height = 24): BlockInput[] {
  return Array.from({ length: count }, () => ({ height, breakBefore: false, keepNext: false }))
}

function measure(run: () => void): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

describe('ページ分割の計算量', () => {
  it('30 ページ相当を 50ms 以内に分割する', () => {
    // 30 ページ ≒ 1100 ブロック
    const input = blocks(1100)
    const elapsed = measure(() => {
      const result = computeBreaks(input, { pageContentHeight: PAGE_HEIGHT })
      expect(result.length).toBeGreaterThan(25)
    })
    expect(elapsed, `${elapsed.toFixed(1)}ms`).toBeLessThan(50)
  })

  it('ブロック数に対して線形に伸びる', () => {
    // 10 倍のブロック数で 10 倍程度に収まること。
    // O(n^2) になっていれば 100 倍近くかかるので、ここで落ちる
    const small = blocks(1000)
    const large = blocks(10_000)

    // 最初の 1 回は JIT の準備が入るので、計測前に温めておく
    computeBreaks(small, { pageContentHeight: PAGE_HEIGHT })
    computeBreaks(large, { pageContentHeight: PAGE_HEIGHT })

    const t1 = measure(() => computeBreaks(small, { pageContentHeight: PAGE_HEIGHT }))
    const t2 = measure(() => computeBreaks(large, { pageContentHeight: PAGE_HEIGHT }))

    // 計測が速すぎると比が暴れるので、下限を置いて比べる
    const ratio = Math.max(t2, 0.1) / Math.max(t1, 0.1)
    expect(ratio, `1000→10000 で ${ratio.toFixed(1)} 倍 (${t1.toFixed(2)}ms → ${t2.toFixed(2)}ms)`).toBeLessThan(
      40
    )
  })

  it('keepNext が長く連なっても破綻しない', () => {
    // keepNext は「同じページに送る」ために後戻りする。
    // 素朴に書くと連なりの長さに対して O(n^2) になりやすい
    const input: BlockInput[] = Array.from({ length: 5000 }, () => ({
      height: 24,
      breakBefore: false,
      keepNext: true
    }))
    const elapsed = measure(() => computeBreaks(input, { pageContentHeight: PAGE_HEIGHT }))
    expect(elapsed, `${elapsed.toFixed(1)}ms`).toBeLessThan(200)
  })

  it('1 ページに収まらない巨大なブロックで無限に改ページしない', () => {
    // 送っても収まらないので、そのページに置いて溢れさせる規則。
    // ここを誤ると終わらないループになる
    const input: BlockInput[] = [
      { height: PAGE_HEIGHT * 5, breakBefore: false, keepNext: false },
      { height: 24, breakBefore: false, keepNext: false }
    ]
    const elapsed = measure(() => {
      const result = computeBreaks(input, { pageContentHeight: PAGE_HEIGHT })
      expect(result.length).toBeLessThan(10)
    })
    expect(elapsed).toBeLessThan(50)
  })
})
