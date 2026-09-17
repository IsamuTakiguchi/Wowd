/**
 * w:numFmt に従って序数を表示文字列に変換する。
 *
 * 純粋関数だけを置く。日本語書式 (aiueoFullWidth / ideographDigital / japaneseCounting など) は
 * Word の実装に合わせてあり、ここがずれるとリストの見た目が Word と食い違う。
 */

const AIUEO = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'
const AIUEO_FULL = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'
const IROHA = 'いろはにほへとちりぬるをわかよたれそつねならむうゐのおくやまけふこえてあさきゆめみしゑひもせす'
const IROHA_FULL = 'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス'

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const PAREN_DECIMAL = '⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇'

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i']
]

function toRoman(n: number): string {
  if (n <= 0 || n > 3999) return String(n)
  let out = ''
  let rest = n
  for (const [value, sym] of ROMAN) {
    while (rest >= value) {
      out += sym
      rest -= value
    }
  }
  return out
}

/** 1 → a, 26 → z, 27 → aa */
function toLetter(n: number): string {
  if (n <= 0) return String(n)
  let out = ''
  let rest = n
  while (rest > 0) {
    rest -= 1
    out = String.fromCharCode(97 + (rest % 26)) + out
    rest = Math.floor(rest / 26)
  }
  return out
}

/** かな系は 1 周したら 2 文字重ねる (Word の挙動) */
function fromSequence(n: number, seq: string): string {
  if (n <= 0) return String(n)
  const chars = Array.from(seq)
  const idx = (n - 1) % chars.length
  const repeat = Math.floor((n - 1) / chars.length) + 1
  return chars[idx]!.repeat(repeat)
}

function toFullWidthDigits(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + Number(d)))
}

/** 各桁をそのまま漢数字に置き換える (1234 → 一二三四)。位取りはしない */
function toIdeographDigital(n: number): string {
  return String(n)
    .split('')
    .map((d) => KANJI_DIGITS[Number(d)] ?? d)
    .join('')
}

/** 位取りのある漢数字 (1234 → 千二百三十四)。Word の japaneseCounting */
function toJapaneseCounting(n: number): string {
  if (n === 0) return '〇'
  if (n < 0) return '-' + toJapaneseCounting(-n)
  if (n > 99999999) return String(n)

  const smallUnits = ['', '十', '百', '千']

  const under10000 = (v: number): string => {
    let out = ''
    const digits = String(v).split('').map(Number).reverse()
    for (let i = digits.length - 1; i >= 0; i--) {
      const d = digits[i]!
      if (d === 0) continue
      // 一十 / 一百 / 一千 とは書かず 十 / 百 / 千 と書く
      const unit = smallUnits[i] ?? ''
      if (d === 1 && i > 0) out += unit
      else out += (KANJI_DIGITS[d] ?? String(d)) + unit
    }
    return out
  }

  const man = Math.floor(n / 10000)
  const rest = n % 10000
  if (man === 0) return under10000(rest)
  return under10000(man) + '万' + (rest === 0 ? '' : under10000(rest))
}

/** 大字 (壱弐参...)。契約書で使われる */
function toJapaneseLegal(n: number): string {
  const legal = ['零', '壱', '弐', '参', '四', '五', '六', '七', '八', '九']
  return toJapaneseCounting(n)
    .split('')
    .map((c) => {
      const i = KANJI_DIGITS.indexOf(c)
      if (i >= 0) return legal[i]!
      if (c === '十') return '拾'
      return c
    })
    .join('')
}

/**
 * 序数 n を numFmt に従って文字列にする。
 * 未知の書式は decimal にフォールバックする (番号が消えるより良い)。
 */
export function formatNumber(n: number, numFmt: string): string {
  switch (numFmt) {
    case 'decimal':
    case 'decimalHalfWidth':
      return String(n)
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n)
    case 'decimalFullWidth':
    case 'decimalFullWidth2':
      return toFullWidthDigits(n)
    case 'upperLetter':
      return toLetter(n).toUpperCase()
    case 'lowerLetter':
      return toLetter(n)
    case 'upperRoman':
      return toRoman(n).toUpperCase()
    case 'lowerRoman':
      return toRoman(n)
    case 'decimalEnclosedCircle':
    case 'decimalEnclosedCircleChinese':
      return n >= 1 && n <= CIRCLED.length ? Array.from(CIRCLED)[n - 1]! : String(n)
    case 'decimalEnclosedParen':
      return n >= 1 && n <= PAREN_DECIMAL.length ? Array.from(PAREN_DECIMAL)[n - 1]! : `(${n})`
    case 'aiueo':
      return fromSequence(n, AIUEO)
    case 'aiueoFullWidth':
      return fromSequence(n, AIUEO_FULL)
    case 'iroha':
      return fromSequence(n, IROHA)
    case 'irohaFullWidth':
      return fromSequence(n, IROHA_FULL)
    case 'ideographDigital':
      return toIdeographDigital(n)
    case 'japaneseCounting':
    case 'ideographTraditional':
    case 'chineseCounting':
      return toJapaneseCounting(n)
    case 'japaneseLegal':
      return toJapaneseLegal(n)
    case 'bullet':
    case 'none':
      // bullet は lvlText をそのまま使うので序数は出てこない
      return ''
    default:
      return String(n)
  }
}

/**
 * w:lvlText の %1〜%9 を各レベルの現在値で置き換える。
 * 例: lvlText='%1.%2', counters=[2,3] → '2.3'
 *
 * @param counters counters[i] が ilvl=i の現在値
 * @param formats  formats[i] が ilvl=i の numFmt
 */
export function renderLevelText(lvlText: string, counters: number[], formats: string[]): string {
  return lvlText.replace(/%([1-9])/g, (_m, d: string) => {
    const idx = Number(d) - 1
    const value = counters[idx]
    if (value == null) return ''
    return formatNumber(value, formats[idx] ?? 'decimal')
  })
}
