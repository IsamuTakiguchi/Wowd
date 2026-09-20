import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { fixtureNames, readFixture } from './helpers'

/**
 * 往復で**要素が消えていないか**を見る。
 *
 * 既存の往復テストは「読み直したモデルが同じになるか」(冪等性) を見ている。
 * これには盲点がある: **読み取りが落とし、書き出しも出さない要素**は
 * 2 回目もやはり落ちるので、モデルは一致して素通りする。
 * scripts/verify-roundtrip.ts は document.xml の差分を表示はするが、
 * 判定には使っていない (許容済みの差分が常にあるため)。
 *
 * 実際にこの穴を通ったのが w:pPrChange だった。
 * 変更前の段落書式 (子の w:pPr) が読み捨てられ、属性だけの空要素として
 * 書き戻されていた。情報が落ちるうえ CT_PPrChange は子を必須とするので
 * 規格違反でもあった。冪等性テストにも、当時のスキーマ検証にも映らなかった
 * (フィクスチャに w:pPrChange が 1 つも無かったため)。
 *
 * ここでは 2 つを見る:
 *   1. 文字が 1 字も失われていないこと
 *   2. 要素の出現数が減っていないこと
 *
 * 2 から w:r / w:t を除くのは、**空のラン**が正規化で消えるため。
 * 空セルの <w:p><w:r><w:t/></w:r></w:p> は <w:p/> になる。
 * Word 自身が空セルをそう書くので、これは欠落ではない。
 * 中身のあるランが消える場合は 1 が捕まえる。
 */

/** 開始タグの出現数をタグ名ごとに数える */
function elementCounts(xml: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of xml.matchAll(/<([A-Za-z][A-Za-z0-9]*:[A-Za-z][A-Za-z0-9]*)[\s/>]/g)) {
    const tag = m[1] ?? ''
    out.set(tag, (out.get(tag) ?? 0) + 1)
  }
  return out
}

/** w:t の中身をすべてつなげる。属性の違いは無視する */
function allText(xml: string): string {
  return [...xml.matchAll(/<w:(?:t|delText)\b[^>]*>([\s\S]*?)<\/w:(?:t|delText)>/g)]
    .map((m) => m[1] ?? '')
    .join('')
}

/**
 * 開始タグごとの (タグ名, 属性名) の出現数。
 *
 * 要素の数だけ見ていると**属性の欠落を見落とす**。
 * 実際に w:p の w14:textId と w:rsid* が落ちていて、
 * Word の文書比較が使う情報が「開いて保存しただけ」で消えていた。
 */
function attrCounts(xml: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const tag of xml.matchAll(/<([A-Za-z][\w]*:[A-Za-z][\w]*)((?:\s[^>]*)?)\/?>/g)) {
    const name = tag[1] ?? ''
    for (const a of (tag[2] ?? '').matchAll(/\s([A-Za-z][\w]*:[A-Za-z][\w]*)=/g)) {
      const key = `${name}/${a[1]}`
      out.set(key, (out.get(key) ?? 0) + 1)
    }
  }
  return out
}

/**
 * 落ちてもよい属性。**タグ名まで含めて限定する。**
 *
 * - w:r の w:rsid*: ランはエディタで結合・分割されるので、
 *   ラン単位の編集セッション印は原理的に対応を保てない
 * - w:ins / w:del の w16du:dateUtc: w:date の UTC 表記の控えで、
 *   Word が書き直す
 *
 * w:p や w:sectPr の w:rsid* は保持する対象なので、ここには入れない。
 */
const ACCEPTED_ATTR_LOSS = new Set([
  // xml:space="preserve" は前後に空白がある場合だけ付ける。
  // docs/round-trip-report.md の「許容済みの差分」に記録済み
  'w:t/xml:space',
  'w:delText/xml:space',
  'w:r/w:rsidR',
  'w:r/w:rsidRPr',
  'w:r/w:rsidDel',
  'w:ins/w16du:dateUtc',
  'w:del/w16du:dateUtc'
])

/** before にあって after で減った (タグ, 属性) を返す */
function lostAttrs(before: string, after: string): string[] {
  const a = attrCounts(before)
  const b = attrCounts(after)
  const lost: string[] = []
  for (const [key, n] of a) {
    if (ACCEPTED_ATTR_LOSS.has(key)) continue
    const m = b.get(key) ?? 0
    if (m < n) lost.push(`${key}: ${n} -> ${m}`)
  }
  return lost
}

/** 空ランの正規化で数が減りうるタグ。文字の欠落は allText が見る */
const NORMALIZED = new Set(['w:r', 'w:t'])

function roundTrip(name: string): { before: string; after: string } {
  const bytes = readFixture(name)
  const doc = readDocx(bytes, null)
  const part = doc.resources.documentPartName
  const before = strFromU8(unzipSync(bytes)[part]!)
  const after = strFromU8(unzipSync(writeDocx(doc, doc.pkg, {}))[part]!)
  return { before, after }
}

describe('往復で情報が落ちないこと', () => {
  for (const name of fixtureNames()) {
    it(`${name}: 文字が失われない`, () => {
      const { before, after } = roundTrip(name)
      expect(allText(after)).toBe(allText(before))
    })

    it(`${name}: 要素が失われない`, () => {
      const { before, after } = roundTrip(name)
      const a = elementCounts(before)
      const b = elementCounts(after)
      const lost: string[] = []
      for (const [tag, n] of a) {
        if (NORMALIZED.has(tag)) continue
        const m = b.get(tag) ?? 0
        if (m < n) lost.push(`${tag}: ${n} -> ${m}`)
      }
      expect(lost, `往復で消えた要素:\n  ${lost.join('\n  ')}`).toEqual([])
    })

    it(`${name}: 属性が失われない`, () => {
      const { before, after } = roundTrip(name)
      const lost = lostAttrs(before, after)
      expect(lost, `往復で消えた属性:\n  ${lost.join('\n  ')}`).toEqual([])
    })
  }
})

describe('書式の変更履歴', () => {
  /**
   * w:pPrChange / w:rPrChange は「変更前の書式」を子要素として持つ。
   * 属性 (誰がいつ) だけ残して子を捨てると、変更前に戻せなくなるうえ
   * 規格違反になる。10-revisions.docx に両方を入れてある。
   */
  it('変更前の書式がそのまま書き戻される', () => {
    const { before, after } = roundTrip('10-revisions.docx')

    for (const tag of ['w:pPrChange', 'w:rPrChange'] as const) {
      const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`)
      const original = re.exec(before)?.[0]
      expect(original, `フィクスチャに ${tag} が無い`).toBeTruthy()
      expect(after, `${tag} の中身が失われた`).toContain(original!)
    }
  })
})
