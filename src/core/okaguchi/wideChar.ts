/**
 * 岡口マクロの「全角1文字入力」(Alt+Z)。
 *
 * (1) (a) (ｱ) のような括弧付きの符号を、括弧を半分の幅 (横幅 50%) にして
 * 全角 1 字分の幅に収める。出典: 岡口マクロ_全角1文字入力.frm。
 */
import { toNarrowAscii } from './dates'

const HALF_KANA: Record<string, string> = {}
{
  const table: [string, string][] = [
    ['ァ', 'ｧ'], ['ア', 'ｱ'], ['ィ', 'ｨ'], ['イ', 'ｲ'], ['ゥ', 'ｩ'], ['ウ', 'ｳ'], ['ェ', 'ｪ'], ['エ', 'ｴ'],
    ['ォ', 'ｫ'], ['オ', 'ｵ'], ['カ', 'ｶ'], ['ガ', 'ｶﾞ'], ['キ', 'ｷ'], ['ギ', 'ｷﾞ'], ['ク', 'ｸ'], ['グ', 'ｸﾞ'],
    ['ケ', 'ｹ'], ['ゲ', 'ｹﾞ'], ['コ', 'ｺ'], ['ゴ', 'ｺﾞ'], ['サ', 'ｻ'], ['ザ', 'ｻﾞ'], ['シ', 'ｼ'], ['ジ', 'ｼﾞ'],
    ['ス', 'ｽ'], ['ズ', 'ｽﾞ'], ['セ', 'ｾ'], ['ゼ', 'ｾﾞ'], ['ソ', 'ｿ'], ['ゾ', 'ｿﾞ'], ['タ', 'ﾀ'], ['ダ', 'ﾀﾞ'],
    ['チ', 'ﾁ'], ['ヂ', 'ﾁﾞ'], ['ッ', 'ｯ'], ['ツ', 'ﾂ'], ['ヅ', 'ﾂﾞ'], ['テ', 'ﾃ'], ['デ', 'ﾃﾞ'], ['ト', 'ﾄ'],
    ['ド', 'ﾄﾞ'], ['ナ', 'ﾅ'], ['ニ', 'ﾆ'], ['ヌ', 'ﾇ'], ['ネ', 'ﾈ'], ['ノ', 'ﾉ'], ['ハ', 'ﾊ'], ['バ', 'ﾊﾞ'],
    ['パ', 'ﾊﾟ'], ['ヒ', 'ﾋ'], ['ビ', 'ﾋﾞ'], ['ピ', 'ﾋﾟ'], ['フ', 'ﾌ'], ['ブ', 'ﾌﾞ'], ['プ', 'ﾌﾟ'], ['ヘ', 'ﾍ'],
    ['ベ', 'ﾍﾞ'], ['ペ', 'ﾍﾟ'], ['ホ', 'ﾎ'], ['ボ', 'ﾎﾞ'], ['ポ', 'ﾎﾟ'], ['マ', 'ﾏ'], ['ミ', 'ﾐ'], ['ム', 'ﾑ'],
    ['メ', 'ﾒ'], ['モ', 'ﾓ'], ['ャ', 'ｬ'], ['ヤ', 'ﾔ'], ['ュ', 'ｭ'], ['ユ', 'ﾕ'], ['ョ', 'ｮ'], ['ヨ', 'ﾖ'],
    ['ラ', 'ﾗ'], ['リ', 'ﾘ'], ['ル', 'ﾙ'], ['レ', 'ﾚ'], ['ロ', 'ﾛ'], ['ヮ', 'ﾜ'], ['ワ', 'ﾜ'], ['ヰ', 'ｲ'],
    ['ヱ', 'ｴ'], ['ヲ', 'ｦ'], ['ン', 'ﾝ'], ['ヴ', 'ｳﾞ'], ['ー', 'ｰ'], ['・', '･'], ['「', '｢'], ['」', '｣'],
    ['、', '､'], ['。', '｡']
  ]
  for (const [full, half] of table) HALF_KANA[full] = half
}

/** 全角 → 半角 (英数字・記号・空白に加えて、カタカナも半角カナにする。VBA の StrConv(vbNarrow)) */
export function toNarrowWithKana(s: string): string {
  return Array.from(toNarrowAscii(s))
    .map((ch) => HALF_KANA[ch] ?? ch)
    .join('')
}

/** Shift_JIS にしたときのバイト数 (全角 2・半角 1)。半角カナは 1 */
export function sjisWidth(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    n += c < 0x80 || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2
  }
  return n
}

export interface ScaledRun {
  text: string
  /** 横幅 (%)。100 なら縮めない */
  w: number
}

/**
 * 差し込む文字の並び。
 *
 * @param fit 括弧の中が半角 2 字以上または全角でも、全角 1 字分に収める
 *            (中の文字を 100 / バイト数 % にする)
 * @param noSpace 後ろに全角スペースを入れない
 */
export function wideOneChar(input: string, options: { fit: boolean; noSpace: boolean }): ScaledRun[] {
  const inner = toNarrowWithKana(input)
  if (inner === '') return []
  const bytes = sjisWidth(inner)
  // Word の横幅は整数 (VBA の暗黙の変換は偶数丸め。0.5 ちょうどは起きない)
  const innerW = options.fit && bytes > 1 ? Math.round(100 / bytes) : 100
  const runs: ScaledRun[] = [
    { text: '(', w: 50 },
    { text: inner, w: innerW },
    { text: ')', w: 50 }
  ]
  if (!options.noSpace) runs.push({ text: '\u3000', w: 100 })
  return runs
}
