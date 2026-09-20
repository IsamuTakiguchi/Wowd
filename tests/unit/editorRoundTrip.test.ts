import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { buildExtensions } from '@renderer/editor/extensions'
import { fromWowdDoc } from '@renderer/editor/serialize/fromWowdDoc'
import { toWowdDoc } from '@renderer/editor/serialize/toWowdDoc'
import { DEFAULT_RUN_PROPS } from '@core/css/runCss'
import { DEFAULT_PARAGRAPH_ATTRS } from '@renderer/editor/extensions/paragraphAttrs'
import type { Mark, WowdDoc, ParagraphNode, TextNode } from '@core/model/types'
import { fixtureNames, readFixture } from './helpers'

/**
 * **利用者が実際に通る経路**で情報が落ちないかを見る。
 *
 * tests/unit/roundTripFidelity.test.ts が見ているのは read → write だけで、
 * 間にエディタが入らない。だが「開いて保存する」は必ず
 * モデル → ProseMirror → モデル を通る。ここには固有の落とし穴がある:
 *
 *   **ProseMirror はスキーマに宣言の無いマーク属性を黙って捨てる。**
 *
 * 実際に 2 つ落ちていた:
 *   - textStyle: モデルは RunProps を平らに持つのに、拡張は
 *     runProps 1 個の入れ子で宣言していた。形が違うので全滅し、
 *     w:rFonts (フォント) と w:sz (文字サイズ) が開いて保存しただけで消えた
 *   - underline: TipTap 既定の下線は属性を持たないので、
 *     w:u の val (二重下線など) と色が消えた
 *
 * どちらも Word は修復を出さない。**黙って書式が失われる**ので、
 * 実機で開いても気づけない種類の壊れ方になる。
 *
 * ここでは Editor.tsx と同じ経路を組み立てる:
 *   readDocx → fromWowdDoc → PM スキーマ (setContent 相当) → toWowdDoc → writeDocx
 */

const schema = getSchema(buildExtensions() as never)

/** editor.commands.setContent + editor.getJSON() と同じ絞り込みをかける */
function throughProseMirror(json: unknown): unknown {
  return PMNode.fromJSON(schema, json as never).toJSON()
}

function editorRoundTrip(name: string): { before: string; after: string } {
  const bytes = readFixture(name)
  const loaded = readDocx(bytes, null)
  const part = loaded.resources.documentPartName
  const before = strFromU8(unzipSync(bytes)[part]!)

  const pm = throughProseMirror(fromWowdDoc(loaded.doc))
  const saved = { ...loaded, doc: toWowdDoc(pm as never) }
  const after = strFromU8(unzipSync(writeDocx(saved, loaded.pkg, {}))[part]!)
  return { before, after }
}

/** 開始タグの出現数をタグ名ごとに数える */
function elementCounts(xml: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of xml.matchAll(/<([A-Za-z][A-Za-z0-9]*:[A-Za-z][A-Za-z0-9]*)[\s/>]/g)) {
    const tag = m[1] ?? ''
    out.set(tag, (out.get(tag) ?? 0) + 1)
  }
  return out
}

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

describe('開いて保存しても情報が落ちないこと', () => {
  for (const name of fixtureNames()) {
    it(`${name}: 文字が失われない`, () => {
      const { before, after } = editorRoundTrip(name)
      expect(allText(after)).toBe(allText(before))
    })

    it(`${name}: 要素が失われない`, () => {
      const { before, after } = editorRoundTrip(name)
      const a = elementCounts(before)
      const b = elementCounts(after)
      const lost: string[] = []
      for (const [tag, n] of a) {
        if (NORMALIZED.has(tag)) continue
        const m = b.get(tag) ?? 0
        if (m < n) lost.push(`${tag}: ${n} -> ${m}`)
      }
      expect(lost, `開いて保存したら消えた要素:\n  ${lost.join('\n  ')}`).toEqual([])
    })

    it(`${name}: 属性が失われない`, () => {
      const { before, after } = editorRoundTrip(name)
      const lost = lostAttrs(before, after)
      expect(lost, `開いて保存したら消えた属性:\n  ${lost.join('\n  ')}`).toEqual([])
    })
  }
})

describe('マークの属性が往復で戻ること', () => {
  /**
   * ProseMirror はスキーマに宣言の無いマーク属性を黙って捨てる。
   * モデルと同じ形で宣言するか (link / comment / 改訂)、
   * シリアライザで形を変換するか (textStyle) のどちらかが要る。
   * どちらでもよいので、**往復して戻ること**だけを見る。
   *
   * 既定値ではない値を入れておくのが要点。既定値だと、
   * 属性が捨てられて既定に戻っても一致してしまい、素通りする。
   */
  const MARKS: Mark[] = [
    {
      type: 'textStyle',
      attrs: {
        ...DEFAULT_RUN_PROPS,
        rFonts: { ascii: 'Times New Roman', eastAsia: '游明朝' },
        sz: 24,
        color: 'FF0000',
        rawRPr: '<w:em w:val="dot"/>'
      }
    },
    { type: 'underline', attrs: { val: 'double', color: '0000FF' } },
    {
      type: 'link',
      attrs: { href: null, anchor: '見出し1', rId: 'rId9', tooltip: 'ここへ' }
    },
    { type: 'comment', attrs: { ids: ['1', '2'] } },
    { type: 'insertion', attrs: { id: 7, author: '校閲者A', date: '2026-01-01T00:00:00Z' } },
    { type: 'deletion', attrs: { id: 8, author: '校閲者B', date: '2026-01-02T00:00:00Z' } }
  ]

  for (const mark of MARKS) {
    it(`${mark.type}`, () => {
      const doc: WowdDoc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { ...DEFAULT_PARAGRAPH_ATTRS },
            content: [{ type: 'text', text: '本文', marks: [mark] }]
          }
        ]
      }
      const back = toWowdDoc(throughProseMirror(fromWowdDoc(doc)) as never)
      const para = back.content[0] as ParagraphNode
      const text = para.content?.[0] as TextNode
      expect(text.marks, `${mark.type} のマークごと消えた`).toHaveLength(1)
      expect(text.marks?.[0]).toEqual(mark)
    })
  }
})
