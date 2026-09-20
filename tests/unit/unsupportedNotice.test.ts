import { describe, it, expect } from 'vitest'
import { unsupportedLabel, unsupportedLabels, LAYOUT_LIMITS } from '@core/docx/unsupportedLabels'
import { overflowingBlocks, type BlockInput } from '@core/layout/pageBreaks'

/**
 * 未対応であることの伝え方。
 *
 * **黙って落とさない**のがこの製品の方針。
 * 落とさない以上、何が起きているかが伝わる形で出す必要がある。
 * 生のタグ名を並べても伝わらない。
 */
describe('未対応要素の名前', () => {
  it('よく出るものは日本語にする', () => {
    expect(unsupportedLabel('w:footnoteReference')).toBe('脚注')
    expect(unsupportedLabel('w:sdt')).toBe('コンテンツ コントロール')
  })

  it('知らないタグはそのまま出す', () => {
    // 黙って隠すより、見慣れない名前でも出ているほうがよい。
    // 名前が分からないのはこちらの手落ちで、伝えない理由にはならない
    expect(unsupportedLabel('w:未知の要素')).toBe('w:未知の要素')
  })

  it('同じ名前に落ちるものはまとめる', () => {
    // 「数式」が 2 つ並ばないように
    const out = unsupportedLabels(['m:oMath', 'm:oMathPara', 'w:sdt'])
    expect(out).toEqual(['コンテンツ コントロール', '数式'])
  })

  it('描けない指定は「できないこと」まで書く', () => {
    // 「段組み」だけでは、消えたのか描けないだけなのか分からない
    expect(LAYOUT_LIMITS.columns).toContain('1 段で表示')
    expect(LAYOUT_LIMITS.footnotePlacement).toContain('本文の流れ')
  })
})

describe('紙からはみ出すブロック', () => {
  const block = (height: number): BlockInput => ({ height, breakBefore: false, keepNext: false })

  it('1 ページより高いものを数える', () => {
    // 表はページ間で分割しないので、長い表でこれが起きる。
    // 溢れること自体は無限ループを避けるための正しい動きだが、
    // 利用者からは紙からはみ出して見える
    const blocks = [block(100), block(1200), block(200), block(900)]
    expect(overflowingBlocks(blocks, { pageContentHeight: 900 })).toEqual([1])
  })

  it('ちょうど収まるものは数えない', () => {
    expect(overflowingBlocks([block(900)], { pageContentHeight: 900 })).toEqual([])
  })

  it('高さが取れていないときは何も言わない', () => {
    // 測る前に呼ばれることがある。そこで警告を出すと出っぱなしになる
    expect(overflowingBlocks([block(100)], { pageContentHeight: 0 })).toEqual([])
  })
})
