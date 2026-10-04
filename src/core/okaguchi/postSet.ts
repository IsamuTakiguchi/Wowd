/**
 * 岡口マクロの「連番等事後設定」(Alt+J)。
 *
 * 手で打った見出し符号 (第１ / １ / （１）・⑴ / ア / （ア） / ａ / （ａ） / ①) を
 * 段落の先頭から見つけ、連番ランクのスタイル (= 自動の番号) に置き換える。
 * 見出しの無い段落には、直前の見出しの階層に合った「本文N」を当てる。
 *
 * 出典: 岡口マクロ_連番等事後設定.frm。直した不具合 (仕様 8.6):
 * - 10 以上の番号 (第１０、１０、（１０）) を見つけられなかった
 * - ⑵ 以降を見つけられなかった
 * - ン・⑳ を超えると実行時エラーで止まった、z の次が「{」になった
 * - 既に連番ランクのスタイルが当たった段落を本文にしてしまうことがあった
 */
import { toWideAscii } from './dates'

const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'
const PAREN_DIGITS = '⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇'
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const SP = '　'

/** 階層 n の値 v を、手で打つときの字にする。範囲外は null */
function glyph(level: number, v: number): string | null {
  switch (level) {
    case 1:
    case 2:
    case 3:
      return toWideAscii(String(v))
    case 4:
    case 5:
      return Array.from(KANA)[v - 1] ?? null
    case 6:
    case 7:
      return v >= 1 && v <= 26 ? toWideAscii(String.fromCharCode(96 + v)) : null
    case 8:
      return Array.from(CIRCLED)[v - 1] ?? null
    default:
      return null
  }
}

/**
 * 段落の先頭が、階層 level の値 v の見出し符号か。合えば消す字数を返す。
 *
 * 比べる前に英数字・記号を全角にするので、半角で打った「1 」「(1)」も見つかる。
 */
function matchMarker(text: string, level: number, v: number): number | null {
  const g = glyph(level, v)
  const wide = toWideAscii(text)
  const spaced = (marker: string): number | null =>
    wide.startsWith(marker + SP) ? marker.length + 1 : null
  const paren = (marker: string): number | null => {
    if (!wide.startsWith(marker)) return null
    // 括弧のあとの空白も消す (あとで全角空白 1 つに置き直す)
    return wide.startsWith(marker + SP) ? marker.length + 1 : marker.length
  }
  switch (level) {
    case 1:
      return g ? spaced(`第${g}`) : null
    case 2:
    case 4:
    case 6:
    case 8:
      return g ? spaced(g) : null
    case 3: {
      const byParen = g ? paren(`（${g}）`) : null
      if (byParen != null) return byParen
      const ch = Array.from(PAREN_DIGITS)[v - 1]
      // ⑴ の字は全角にしないで比べる (後ろは全角でも半角でも空白)
      if (ch && (text.startsWith(ch + SP) || text.startsWith(ch + ' '))) return ch.length + 1
      return null
    }
    case 5:
    case 7:
      return g ? paren(`（${g}）`) : null
    default:
      return null
  }
}

export interface PostSetParagraph {
  text: string
  /** いま当たっているスタイルのランク (1..8)。ランクでなければ null */
  rank: number | null
}

export interface PostSetChange {
  /** 当てるもの: ランク N の見出しか、本文 N か */
  kind: 'rank' | 'body'
  level: number
  /** 先頭から消す字数 (見出し符号と後ろの空白)。消したところに全角空白を 1 つ置く */
  strip: number
  /** 番号を 1 から振り直す (順番どおりでない「１」など) */
  restart: boolean
}

/**
 * どの段落をどう変えるかを決める。
 *
 * 各階層の「次に来るはずの値」を数えながら上から見ていき、
 * - 次に来るはずの値の符号なら、その階層の見出し
 * - 「１」(ア・ａ・① など各階層の最初の値) なら、振り直しの見出し
 * - どちらでもなければ本文 (順番の飛んだ「５」などは見出しとみなさない。元のマクロと同じ)
 *
 * @param bodyIndent 見出しの無い段落にも本文N を当てる
 */
export function planPostSet(
  paragraphs: PostSetParagraph[],
  options: { bodyIndent: boolean }
): Map<number, PostSetChange> {
  const changes = new Map<number, PostSetChange>()
  /** 各階層の、次に来るはずの値 (添字 1..8) */
  const next = [0, 1, 1, 1, 1, 1, 1, 1, 1]
  let current = 0

  const enter = (level: number, value: number): void => {
    next[level] = value + 1
    for (let k = level + 1; k <= 8; k++) next[k] = 1
    current = level
  }

  paragraphs.forEach((p, index) => {
    // 既に連番ランクの見出しになっている段落は、そのまま数に入れる
    if (p.rank != null) {
      enter(p.rank, next[p.rank]!)
      return
    }
    for (let level = 1; level <= 8; level++) {
      const expected = next[level]!
      const strip = matchMarker(p.text, level, expected)
      if (strip != null) {
        changes.set(index, { kind: 'rank', level, strip, restart: false })
        enter(level, expected)
        return
      }
      if (expected !== 1) {
        const restart = matchMarker(p.text, level, 1)
        if (restart != null) {
          changes.set(index, { kind: 'rank', level, strip: restart, restart: true })
          enter(level, 1)
          return
        }
      }
    }
    if (options.bodyIndent && current >= 1) {
      changes.set(index, { kind: 'body', level: current, strip: 0, restart: false })
    }
  })
  return changes
}
