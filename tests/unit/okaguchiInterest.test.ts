import { describe, it, expect } from 'vitest'
import {
  calculateInterest,
  interestReport,
  periodEnd,
  parsePrincipal,
  defaultLegalRate,
  type InterestInput,
  type InterestResult
} from '@core/okaguchi/interest'

function input(partial: Partial<InterestInput>): InterestInput {
  return {
    start: { y: 2020, m: 4, d: 1 },
    end: { y: 2021, m: 6, d: 30 },
    principal: 1_000_000n,
    rate: '3',
    roundHalfUp: false,
    fixed365: false,
    fraction365: false,
    excludeFirstDay: false,
    ...partial
  }
}

function ok(i: InterestInput): InterestResult {
  const r = calculateInterest(i)
  if ('error' in r) throw new Error(r.error)
  return r
}

describe('利息計算 (仕様書 6.5 の例)', () => {
  it('2020/4/1〜2021/6/30、100 万円、年 3%、初日算入 → 1 年 91 日、37479 円', () => {
    const r = ok(input({}))
    expect(r).toMatchObject({ years: 1, days: 91, totalDays: 456, interest: 37479n })
    expect(r.formula).toBe('1000000円×3%×1年＋1000000円×3%×91日/365日')
  })

  it('出力の文章 (全角)', () => {
    const i = input({})
    const lines = interestReport(i, ok(i), { wide: true })
    expect(lines[0]).toBe('利息　３７４７９円')
    expect(lines[4]).toBe('期間　２０２０年（令和２年）４月１日から２０２１年（令和３年）６月３０日まで')
    expect(lines[5]).toBe('日数　１年９１日（通算４５６日）')
  })

  it('半角でも通算日数と計算式を出す (元のマクロは落としていた)', () => {
    const i = input({})
    const lines = interestReport(i, ok(i), { wide: false })
    expect(lines.join('\n')).toContain('(通算456日)')
    expect(lines.join('\n')).toContain('(計算式)')
  })
})

describe('期間の数え方', () => {
  it('ちょうど 1 年 (初日算入で 1/1〜12/31)', () => {
    const r = ok(input({ start: { y: 2021, m: 1, d: 1 }, end: { y: 2021, m: 12, d: 31 } }))
    expect(r).toMatchObject({ years: 1, days: 0, interest: 30000n })
  })

  it('初日算入で 4/1〜翌年 4/1 は 1 年と 1 日', () => {
    const r = ok(input({ start: { y: 2020, m: 4, d: 1 }, end: { y: 2021, m: 4, d: 1 } }))
    expect(r).toMatchObject({ years: 1, days: 1 })
  })

  it('初日不算入なら 4/1〜翌年 4/1 はちょうど 1 年', () => {
    const r = ok(input({ start: { y: 2020, m: 4, d: 1 }, end: { y: 2021, m: 4, d: 1 }, excludeFirstDay: true }))
    expect(r).toMatchObject({ years: 1, days: 0, totalDays: 365 })
  })

  it('端数日が年をまたぐと、暦年ごとにその年の日数で割る', () => {
    // 2019/11/1〜2020/2/29 (初日算入): 2019 年 61 日 /365、2020 年 60 日 /366
    const r = ok(input({ start: { y: 2019, m: 11, d: 1 }, end: { y: 2020, m: 2, d: 29 } }))
    expect(r.parts).toEqual([
      { days: 61, yearDays: 365 },
      { days: 60, yearDays: 366 }
    ])
    expect(r.formula).toBe('1000000円×3%×61日/365日＋1000000円×3%×60日/366日')
    // 30000 × (61/365 + 60/366) = 5013.69… + 4918.03… = 9931.73… → 9931
    expect(r.interest).toBe(9931n)
  })

  it('1 年未満を 365 日で割る指定', () => {
    const r = ok(input({ start: { y: 2019, m: 11, d: 1 }, end: { y: 2020, m: 2, d: 29 }, fraction365: true }))
    expect(r.formula).toBe('1000000円×3%×121日/365日')
  })

  it('1 年を 365 日として全日数で割る指定', () => {
    const r = ok(input({ fixed365: true }))
    expect(r.formula).toBe('1000000円×3%×456日/365日')
    expect(r.interest).toBe(37479n)
  })

  it('2/29 から始まり平年で終わっても、端数が消えない (元のマクロは 0 にしていた)', () => {
    // 2020/2/29 起算 1 年の末日は 2021/2/28。2021/3/31 までは 1 年 31 日
    expect(periodEnd({ y: 2020, m: 2, d: 29 }, 1)).toEqual({ y: 2021, m: 2, d: 28 })
    const r = ok(input({ start: { y: 2020, m: 2, d: 29 }, end: { y: 2021, m: 3, d: 31 } }))
    expect(r).toMatchObject({ years: 1, days: 31 })
  })

  it('開始日が終了日より後なら知らせる', () => {
    expect(calculateInterest(input({ start: { y: 2021, m: 1, d: 2 }, end: { y: 2021, m: 1, d: 1 } }))).toEqual({
      error: '開始日を終了日以前の日に設定してください。'
    })
  })
})

describe('端数処理と入力', () => {
  it('四捨五入は 0.5 ちょうどで切り上げる (VBA の偶数丸めではない)', () => {
    // 1000 円 × 36.5% × 1 日/365 日 = 1 円ちょうど。0.5 円になる組み合わせ: 500 円 × 36.5% × 1/365
    const r = ok(
      input({ principal: 500n, rate: '36.5', start: { y: 2021, m: 1, d: 1 }, end: { y: 2021, m: 1, d: 1 }, roundHalfUp: true })
    )
    expect(r.interest).toBe(1n)
    const floor = ok(
      input({ principal: 500n, rate: '36.5', start: { y: 2021, m: 1, d: 1 }, end: { y: 2021, m: 1, d: 1 } })
    )
    expect(floor.interest).toBe(0n)
  })

  it('小数の利率は誤差なく扱う (年 14.6%)', () => {
    const r = ok(input({ rate: '14.6', start: { y: 2021, m: 1, d: 1 }, end: { y: 2021, m: 12, d: 31 } }))
    expect(r.interest).toBe(146000n)
  })

  it('元金のカンマ・全角・「円」を受け付ける', () => {
    expect(parsePrincipal('1,000,000')).toBe(1_000_000n)
    expect(parsePrincipal('１０００円')).toBe(1000n)
    expect(parsePrincipal('abc')).toBeNull()
  })

  it('利率を空にしたときの法定利率は、改正の前後で 5% と 3%', () => {
    expect(defaultLegalRate({ y: 2020, m: 3, d: 31 }).rate).toBe('5')
    expect(defaultLegalRate({ y: 2020, m: 4, d: 1 }).rate).toBe('3')
  })
})
