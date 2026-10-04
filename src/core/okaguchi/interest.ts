/**
 * 岡口マクロの「利息・日付計算」(Alt+C)。
 *
 * 元金・年利・開始日・終了日から、**年単位 + 端数日数の日割り**で利息を求める。
 * 端数日は既定で暦年ごとに分け、その年の日数 (365 か 366) で割る。
 *
 * 元のマクロは年数と端数を 9 通りの場合分けで求めていたが、
 * 「期間の末日 = 起算日から N 年後の応当日の前日」(民法 143 条) から
 * 直接求め直した。同じ入力で同じ結果になり、次の不具合が無い (仕様 6.6):
 * - 開始日が 2/29 で終了年が平年のとき、端数が 0 になって利息が少なくなる
 * - 終了日を「5/1」のように 3 字で入れると読めない
 * - 計算式の表示で日数が文字列として連結される (92 日と 90 日が「9290日」)
 * - 半角で入力すると通算日数と計算式が出ない
 *
 * 金額は整数の分数 (BigInt) で計算し、最後に 1 回だけ端数処理する。
 * 浮動小数の誤差で 0.5 付近の丸めが狂わないようにするため。
 */
import {
  addDays,
  dayNumber,
  fromDayNumber,
  holidayName,
  isValidDate,
  weekday,
  warekiYear,
  toNarrowAscii,
  toWideAscii,
  type SimpleDate
} from './dates'

export interface InterestInput {
  start: SimpleDate
  end: SimpleDate
  /** 元金 (円)。整数 */
  principal: bigint
  /** 年利 (%)。小数可。文字列で受けて誤差なく扱う (例 "14.6") */
  rate: string
  /** 1 円未満を四捨五入する (false なら切り捨て) */
  roundHalfUp: boolean
  /** 1 年を 365 日として、全日数を 365 で割る (閏年の 1 年は 1 年と 1 日) */
  fixed365: boolean
  /** 1 年未満の端数日を、閏年でも 365 で割る */
  fraction365: boolean
  /** 初日を算入しない (民法 140 条) */
  excludeFirstDay: boolean
}

export interface InterestResult {
  interest: bigint
  years: number
  days: number
  totalDays: number
  /** 端数日を暦年に分けたもの (日数 / その年の日数) */
  parts: { days: number; yearDays: number }[]
  formula: string
}

function daysInYear(y: number): number {
  return isValidDate(y, 2, 29) ? 366 : 365
}

/**
 * 起算日から years 年の期間の末日。応当日の前日。
 * 応当日が無い (2/29 → 平年) ときはその月の末日 (民法 143 条 2 項ただし書)。
 */
export function periodEnd(from: SimpleDate, years: number): SimpleDate {
  const y = from.y + years
  if (from.m === 2 && from.d === 29 && !isValidDate(y, 2, 29)) return { y, m: 2, d: 28 }
  return addDays({ y, m: from.m, d: from.d }, -1)
}

/** 年利の文字列を、分子と 10 の何乗分の 1 かに分ける ("14.6" → 146, 1) */
function parseRate(rate: string): { num: bigint; scale: number } | null {
  const s = toNarrowAscii(rate).trim().replace(/%$/, '')
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) return null
  const frac = m[2] ?? ''
  return { num: BigInt(m[1]! + frac), scale: frac.length }
}

export function parsePrincipal(input: string): bigint | null {
  const s = toNarrowAscii(input).trim().replace(/[,，円]/g, '')
  return /^\d+$/.test(s) ? BigInt(s) : null
}

/** a / b を整数に。四捨五入か切り捨て (いずれも正の数) */
function divide(a: bigint, b: bigint, halfUp: boolean): bigint {
  const q = a / b
  if (!halfUp) return q
  return (a % b) * 2n >= b ? q + 1n : q
}

export function calculateInterest(input: InterestInput): InterestResult | { error: string } {
  const rate = parseRate(input.rate)
  if (!rate) return { error: '利率は数字で入力してください (例: 3、14.6)。' }

  // 初日算入なら開始日から、不算入なら翌日から数える
  const from = input.excludeFirstDay ? addDays(input.start, 1) : input.start
  const fromN = dayNumber(from)
  const endN = dayNumber(input.end)
  if (endN < fromN - (input.excludeFirstDay ? 1 : 0)) {
    return { error: '開始日を終了日以前の日に設定してください。' }
  }
  const totalDays = Math.max(0, endN - fromN + 1)

  // 丸 N 年
  let years = 0
  while (dayNumber(periodEnd(from, years + 1)) <= endN) years++
  const fractionStart = years === 0 ? fromN : dayNumber(periodEnd(from, years)) + 1
  const days = Math.max(0, endN - fractionStart + 1)

  // 端数日を暦年ごとに分ける
  const parts: { days: number; yearDays: number }[] = []
  let cursor = fractionStart
  while (cursor <= endN) {
    const y = fromDayNumber(cursor).y
    const yearEnd = Math.min(endN, dayNumber({ y, m: 12, d: 31 }))
    parts.push({ days: yearEnd - cursor + 1, yearDays: daysInYear(y) })
    cursor = yearEnd + 1
  }

  // 利息 = 元金 × 利率 × 期間(年)。期間(年)を 365×366 を分母にした分数で表す
  const L = 365n * 366n
  let periodNum: bigint
  if (input.fixed365) {
    periodNum = (BigInt(totalDays) * L) / 365n
  } else if (input.fraction365) {
    periodNum = BigInt(years) * L + (BigInt(days) * L) / 365n
  } else {
    periodNum = BigInt(years) * L
    for (const p of parts) periodNum += (BigInt(p.days) * L) / BigInt(p.yearDays)
  }
  const denominator = 100n * 10n ** BigInt(rate.scale) * L
  const interest = divide(input.principal * rate.num * periodNum, denominator, input.roundHalfUp)

  return {
    interest,
    years,
    days,
    totalDays,
    parts,
    formula: formulaText(input, years, days, totalDays, parts)
  }
}

function formulaText(
  input: InterestInput,
  years: number,
  days: number,
  totalDays: number,
  parts: { days: number; yearDays: number }[]
): string {
  const head = `${input.principal}円×${toNarrowAscii(input.rate).trim().replace(/%$/, '')}%×`
  if (input.fixed365) return `${head}${totalDays}日/365日`
  const terms: string[] = []
  if (years > 0) terms.push(`${head}${years}年`)
  if (days > 0) {
    if (input.fraction365 || parts.every((p) => p.yearDays === 365)) {
      terms.push(`${head}${days}日/365日`)
    } else {
      for (const p of parts) terms.push(`${head}${p.days}日/${p.yearDays}日`)
    }
  }
  return terms.length > 0 ? terms.join('＋') : `${head}0日`
}

/** 結果の文章。元のマクロの表示と同じ並び */
export function interestReport(
  input: InterestInput,
  result: InterestResult,
  options: { wide: boolean; defaultRateNote?: string | null }
): string[] {
  const dateText = (d: SimpleDate): string => `${d.y}年(${warekiYear(d) ?? ''})${d.m}月${d.d}日`
  const rate = toNarrowAscii(input.rate).trim().replace(/%$/, '')
  const lines = [
    `利息\u3000${result.interest}円`,
    '',
    `元金\u3000${input.principal}円`,
    `利率\u3000${rate}%${options.defaultRateNote ? `(${options.defaultRateNote})` : ''}`,
    `期間\u3000${dateText(input.start)}から${dateText(input.end)}まで`,
    `日数\u3000${result.years}年${result.days}日(通算${result.totalDays}日)`,
    '',
    '(計算式)',
    result.formula
  ]
  const notes: string[] = []
  for (const d of [input.start, input.end]) {
    const holiday = holidayName(d)
    const w = weekday(d)
    const label = holiday ?? (w === 0 ? '日曜日' : w === 6 ? '土曜日' : null)
    if (label) notes.push(`${dateText(d)}は${label}です。`)
  }
  if (notes.length > 0) lines.push('', ...notes)
  return lines.map((l) => (options.wide ? toWideAscii(l) : toNarrowAscii(l)))
}

/**
 * 利率を空欄にしたときの法定利率。
 *
 * 元のマクロは旧民法の年 5% だった。2020 年 4 月 1 日の改正後は年 3% (民法 404 条)。
 * 法定利率は利息が生じた最初の時点のものを使うので、開始日で決める。
 */
export function defaultLegalRate(start: SimpleDate): { rate: string; note: string } {
  return dayNumber(start) >= dayNumber({ y: 2020, m: 4, d: 1 })
    ? { rate: '3', note: '法定利率' }
    : { rate: '5', note: '改正前の法定利率' }
}
