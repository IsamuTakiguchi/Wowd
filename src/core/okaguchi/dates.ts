/**
 * 岡口マクロの日付まわり (日付入力・利息計算で共通)。
 *
 * - 日付の入力の読み取り (`r2/5/3`, `2004/12/5`, `9/15`, 空なら今日)
 * - 和暦 (「令和２年」「平成元年」)
 * - 休日の判定
 *
 * 休日は元のマクロの表を写さず、祝日法に沿って求め直した。元の表には
 * 2020・2021 年の移動 (五輪) が無い、1966〜1995 年の体育の日が無い、
 * 振替休日が「翌日が月曜」の形しか無い、などの誤りがあったため (仕様 C-3)。
 */

export interface SimpleDate {
  y: number
  m: number
  d: number
}

export interface ParsedDate extends SimpleDate {
  /** 入力された月・日の文字 (前ゼロを含めて入力どおり)。出力に使う */
  monthText: string
  dayText: string
}

const ERA_BASE: Record<string, number> = { M: 1867, T: 1911, S: 1925, H: 1988, R: 2018 }

/** 半角にする (英数字・記号・空白)。カナは触らない */
export function toNarrowAscii(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

/**
 * 日付の入力を読む。読めなければ null。
 *
 * 元のマクロは文字数と「/」の位置で読んでいた。同じ入力をすべて受け付けたうえで、
 * 区切りに「.」「-」、年月日の「年」「月」「日」も受け付ける。
 * 元号の記号 (M/T/S/H/R) の範囲は元のマクロと同じく確かめない (h31/5/1 は 2019/5/1)。
 */
export function parseDateInput(input: string, today: SimpleDate): ParsedDate | null {
  const s = toNarrowAscii(input).trim().replace(/[.\-年月]/g, '/').replace(/日$/, '').replace(/\s+/g, '')
  if (s === '') {
    return { ...today, monthText: String(today.m), dayText: String(today.d) }
  }
  const parts = s.split('/')
  let yearText: string
  let monthText: string
  let dayText: string
  if (parts.length === 2) {
    yearText = String(today.y)
    ;[monthText, dayText] = parts as [string, string]
  } else if (parts.length === 3) {
    ;[yearText, monthText, dayText] = parts as [string, string, string]
  } else {
    return null
  }
  if (!/^\d{1,2}$/.test(monthText) || !/^\d{1,2}$/.test(dayText)) return null

  let y: number
  const era = /^([mtshrMTSHR])(\d{1,2})$/.exec(yearText)
  if (era) {
    y = ERA_BASE[era[1]!.toUpperCase()]! + Number(era[2])
  } else if (/^\d{4}$/.test(yearText)) {
    y = Number(yearText)
  } else if (/^\d{1,2}$/.test(yearText)) {
    // 元号の無い 2 桁の年。VBA の日付の解釈と同じく 30 未満は 2000 年代
    const n = Number(yearText)
    y = n < 30 ? 2000 + n : 1900 + n
  } else {
    return null
  }
  const m = Number(monthText)
  const d = Number(dayText)
  if (!isValidDate(y, m, d)) return null
  return { y, m, d, monthText, dayText }
}

export function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= daysInMonth(y, m)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** 通し日数 (1970-01-01 = 0)。日付の差や曜日の計算に使う */
export function dayNumber(date: SimpleDate): number {
  return Math.round(Date.UTC(date.y, date.m - 1, date.d) / 86_400_000)
}

export function fromDayNumber(n: number): SimpleDate {
  const t = new Date(n * 86_400_000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

export function addDays(date: SimpleDate, days: number): SimpleDate {
  return fromDayNumber(dayNumber(date) + days)
}

/** 0 = 日曜 … 6 = 土曜 */
export function weekday(date: SimpleDate): number {
  return (((dayNumber(date) + 4) % 7) + 7) % 7
}

export const WEEKDAY_NAMES = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']

const ERAS: { name: string; start: SimpleDate }[] = [
  { name: '令和', start: { y: 2019, m: 5, d: 1 } },
  { name: '平成', start: { y: 1989, m: 1, d: 8 } },
  { name: '昭和', start: { y: 1926, m: 12, d: 25 } },
  { name: '大正', start: { y: 1912, m: 7, d: 30 } },
  { name: '明治', start: { y: 1868, m: 1, d: 1 } }
]

/**
 * 和暦の「元号＋年」。1 年は「元年」。例: 令和2年、平成元年。
 *
 * 元号は日付で決める (元のマクロは OS の和暦に頼り、令和を後から補正していた)。
 * 明治より前は null。
 */
export function warekiYear(date: SimpleDate): string | null {
  const n = dayNumber(date)
  for (const era of ERAS) {
    if (n >= dayNumber(era.start)) {
      const year = date.y - era.start.y + 1
      return `${era.name}${year === 1 ? '元' : String(year)}年`
    }
  }
  return null
}

// ---- 休日 ----

/** 祝日法の施行日。これより前は祝日が無い */
const HOLIDAY_LAW_START = dayNumber({ y: 1948, m: 7, d: 20 })
/** 振替休日の始まり */
const SUBSTITUTE_START = dayNumber({ y: 1973, m: 4, d: 12 })
/** 国民の休日 (祝日に挟まれた日) の始まり */
const SANDWICH_START = dayNumber({ y: 1985, m: 12, d: 27 })

/** 春分日 (3 月の日)。1900〜2150 年の近似式 */
export function vernalEquinoxDay(y: number): number {
  if (y < 1980) return Math.floor(20.8357 + 0.242194 * (y - 1980) - Math.floor((y - 1983) / 4))
  if (y <= 2099) return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
  return Math.floor(21.851 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
}

/** 秋分日 (9 月の日)。1900〜2150 年の近似式 */
export function autumnalEquinoxDay(y: number): number {
  if (y < 1980) return Math.floor(23.2588 + 0.242194 * (y - 1980) - Math.floor((y - 1983) / 4))
  if (y <= 2099) return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
  return Math.floor(24.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
}

/** 第 n 月曜日か */
function isNthMonday(date: SimpleDate, n: number): boolean {
  return weekday(date) === 1 && Math.ceil(date.d / 7) === n
}

/** 一度限りの祝日・休日 (皇室の行事、五輪の移動) */
const SPECIAL: Record<string, string> = {
  '1959-4-10': '皇太子明仁親王の結婚の儀',
  '1989-2-24': '昭和天皇の大喪の礼',
  '1990-11-12': '即位礼正殿の儀',
  '1993-6-9': '皇太子徳仁親王の結婚の儀',
  '2019-5-1': '天皇の即位の日',
  '2019-10-22': '即位礼正殿の儀',
  '2020-7-23': '海の日',
  '2020-7-24': 'スポーツの日',
  '2020-8-10': '山の日',
  '2021-7-22': '海の日',
  '2021-7-23': 'スポーツの日',
  '2021-8-8': '山の日'
}

/** 2020・2021 年は五輪で海の日・山の日・スポーツの日が動いた。通常の日には出さない */
function movedAway(y: number): boolean {
  return y === 2020 || y === 2021
}

/**
 * 国民の祝日の名前 (振替休日・国民の休日を除く)。祝日でなければ null。
 */
export function nationalHolidayName(date: SimpleDate): string | null {
  if (dayNumber(date) < HOLIDAY_LAW_START) return null
  const { y, m, d } = date
  const special = SPECIAL[`${y}-${m}-${d}`]
  if (special) return special

  switch (m) {
    case 1:
      if (d === 1) return '元日'
      if (y <= 1999 ? d === 15 : isNthMonday(date, 2)) return '成人の日'
      return null
    case 2:
      if (y >= 1967 && d === 11) return '建国記念の日'
      if (y >= 2020 && d === 23) return '天皇誕生日'
      return null
    case 3:
      return d === vernalEquinoxDay(y) ? '春分の日' : null
    case 4:
      if (d === 29) return y <= 1988 ? '天皇誕生日' : y <= 2006 ? 'みどりの日' : '昭和の日'
      return null
    case 5:
      if (d === 3) return '憲法記念日'
      if (d === 4 && y >= 2007) return 'みどりの日'
      if (d === 5) return 'こどもの日'
      return null
    case 7:
      if (movedAway(y)) return null
      if (y >= 1996 && y <= 2002 && d === 20) return '海の日'
      if (y >= 2003 && isNthMonday(date, 3)) return '海の日'
      return null
    case 8:
      if (movedAway(y)) return null
      return y >= 2016 && d === 11 ? '山の日' : null
    case 9:
      if (y >= 1966 && y <= 2002 && d === 15) return '敬老の日'
      if (y >= 2003 && isNthMonday(date, 3)) return '敬老の日'
      return d === autumnalEquinoxDay(y) ? '秋分の日' : null
    case 10:
      if (y >= 1966 && y <= 1999 && d === 10) return '体育の日'
      if (y >= 2000 && y <= 2019 && isNthMonday(date, 2)) return '体育の日'
      if (y >= 2022 && isNthMonday(date, 2)) return 'スポーツの日'
      return null
    case 11:
      if (d === 3) return '文化の日'
      if (d === 23) return '勤労感謝の日'
      return null
    case 12:
      return y >= 1989 && y <= 2018 && d === 23 ? '天皇誕生日' : null
    default:
      return null
  }
}

/**
 * 休日の名前。元のマクロと同じく「休日(○○)」の形。休日でなければ null。
 *
 * - 振替休日: 祝日が日曜なら、その後の最初の祝日でない日 (2006 年までは翌日だけ)。
 *   名前は「○○の振替」(元のマクロと同じ)
 * - 国民の休日: 祝日に挟まれた日 (日曜を除く)
 */
export function holidayName(date: SimpleDate): string | null {
  const own = nationalHolidayName(date)
  if (own) return `休日(${own})`
  const n = dayNumber(date)
  if (n >= SUBSTITUTE_START) {
    // 前の日から遡り、祝日が続く間に日曜の祝日があれば振替
    for (let k = 1; k <= 7; k++) {
      const prev = fromDayNumber(n - k)
      const name = nationalHolidayName(prev)
      if (!name) break
      if (weekday(prev) === 0) {
        // 2006 年までは「翌日」だけ
        if (k === 1 || date.y >= 2007) return `休日(${name}の振替)`
        break
      }
    }
  }
  if (n >= SANDWICH_START && weekday(date) !== 0) {
    if (nationalHolidayName(fromDayNumber(n - 1)) && nationalHolidayName(fromDayNumber(n + 1))) {
      return '休日(国民の休日)'
    }
  }
  return null
}

// ---- 日付入力 (Alt+T) ----

export type DateStyle = 'western' | 'wareki' | 'westernWareki' | 'warekiWestern'

export interface DateFormatOptions {
  style: DateStyle
  /** 全角で出す (false なら半角) */
  wide: boolean
  weekday: boolean
  holiday: boolean
}

/**
 * 日付入力の出力。例: 令和２年５月３日（日曜日・休日（憲法記念日））
 *
 * 月・日は入力どおりの文字 (前ゼロを含む)。休日でない日は「平日」。
 * 半角でもカナは半角にしない (元のマクロは「ｽﾎﾟｰﾂの日」になっていた)。
 */
export function formatDateEntry(date: ParsedDate, options: DateFormatOptions): string {
  const western = `${date.y}年`
  const wareki = warekiYear(date) ?? western
  const md = `${date.monthText}月${date.dayText}日`
  let body: string
  switch (options.style) {
    case 'western':
      body = western + md
      break
    case 'wareki':
      body = wareki + md
      break
    case 'westernWareki':
      body = `${western}(${wareki})${md}`
      break
    case 'warekiWestern':
      body = `${wareki}(${western})${md}`
      break
  }
  const notes: string[] = []
  if (options.weekday) notes.push(WEEKDAY_NAMES[weekday(date)]!)
  if (options.holiday) notes.push(holidayName(date) ?? '平日')
  const text = body + (notes.length > 0 ? `(${notes.join('・')})` : '')
  return options.wide ? toWideAscii(text) : toNarrowAscii(text)
}

/** 全角にする (英数字・記号・空白)。漢字・かなはそのまま */
export function toWideAscii(s: string): string {
  return s.replace(/[\x21-\x7e]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, '\u3000')
}
