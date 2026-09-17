import { describe, it, expect } from 'vitest'
import { computeBreaks, spacerHeight, type BlockInput } from '@core/layout/pageBreaks'

const PAGE = 1000

function blocks(...heights: number[]): BlockInput[] {
  return heights.map((height) => ({ height, breakBefore: false, keepNext: false }))
}

function indices(bs: BlockInput[], pageContentHeight = PAGE): number[] {
  return computeBreaks(bs, { pageContentHeight }).map((b) => b.index)
}

describe('computeBreaks', () => {
  it('ページに収まるうちは改ページしない', () => {
    expect(indices(blocks(300, 300, 300))).toEqual([])
  })

  it('溢れるブロックの直前で改ページする', () => {
    // 400 + 400 = 800、次の 400 で 1200 になり溢れる
    expect(indices(blocks(400, 400, 400))).toEqual([2])
  })

  it('ちょうど収まる場合は改ページしない', () => {
    expect(indices(blocks(500, 500))).toEqual([])
  })

  it('連続して溢れれば複数回改ページする', () => {
    expect(indices(blocks(600, 600, 600, 600))).toEqual([1, 2, 3])
  })

  it('先頭ブロックの前では改ページしない', () => {
    const bs = blocks(300)
    bs[0]!.breakBefore = true
    expect(indices(bs)).toEqual([])
  })

  it('pageBreakBefore は空きがあっても改ページする', () => {
    const bs = blocks(100, 100, 100)
    bs[1]!.breakBefore = true
    expect(indices(bs)).toEqual([1])
  })

  it('1 ページより高いブロックは溢れさせる (無限に改ページしない)', () => {
    // 2.5 ページぶんの高さのブロック 1 つ
    expect(indices(blocks(2500))).toEqual([])
  })

  it('巨大ブロックの後も位置を見失わない', () => {
    // 2500 のあと 2500 % 1000 = 500 使用済み。600 は溢れるので改ページ
    expect(indices(blocks(2500, 600))).toEqual([1])
  })

  it('本文領域の高さが 0 なら何もしない', () => {
    expect(indices(blocks(100, 100), 0)).toEqual([])
  })

  it('空の文書でも壊れない', () => {
    expect(indices([])).toEqual([])
  })

  it('残りの空きを正しく返す', () => {
    const result = computeBreaks(blocks(400, 400, 400), { pageContentHeight: PAGE })
    expect(result[0]?.remaining).toBe(200)
  })
})

describe('keepNext', () => {
  it('見出しが独りページ下端に残らないよう一緒に送る', () => {
    // 900 使用済み。見出し 50 + 本文 200 = 250 は収まらないので見出しごと送る
    const bs = blocks(900, 50, 200)
    bs[1]!.keepNext = true
    expect(indices(bs)).toEqual([1])
  })

  it('連なりごと収まるなら改ページしない', () => {
    const bs = blocks(300, 50, 200)
    bs[1]!.keepNext = true
    expect(indices(bs)).toEqual([])
  })

  it('連なりが 1 ページに収まらない場合はブロック単位で判断する', () => {
    // 見出し 50 + 巨大本文 1500。連なり全体 (1550) は 1 ページに収まらないので
    // 塊ごと送る意味は無い。ただし本文 1500 は残り 850 に入らないので
    // 本文の前で改ページする。見出しは前ページに残るが、
    // 連なりがどこにも収まらない以上これは避けられない
    const bs = blocks(100, 50, 1500)
    bs[1]!.keepNext = true
    expect(indices(bs)).toEqual([2])
  })

  it('連なりの途中に pageBreakBefore があればそこで切れる', () => {
    const bs = blocks(900, 50, 200)
    bs[1]!.keepNext = true
    bs[2]!.breakBefore = true
    expect(indices(bs)).toContain(2)
  })
})

describe('spacerHeight', () => {
  it('余り + 下余白 + 隙間 + 上余白', () => {
    expect(spacerHeight(200, 96, 96, 24)).toBe(200 + 96 + 24 + 96)
  })

  it('余りが負でも 0 として扱う', () => {
    expect(spacerHeight(-50, 96, 96, 24)).toBe(96 + 24 + 96)
  })
})
