import { describe, it, expect } from 'vitest'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { stripIgnorableMarkup, ignoredPrefixesOf, countElements } from '@core/docx/mce'
import { validateDocx, schemaAvailable, xmllintAvailable } from '../../scripts/lib/validateOoxml'
import { fixtureNames, readFixture } from './helpers'

/**
 * ECMA-376 の XSD による検証。
 *
 * 子要素の順序は手書きの順序テーブル (write/order.ts) が正だったが、
 * テーブル自体が間違っていたら誰も気づけない。実際 w:headerReference が
 * 漏れており、罫線の辺の順序も規定違反だった。どちらも往復テストは素通りする。
 *
 * 公式 XSD に当てれば、順序・必須属性・値の型を総当たりで見られる。
 *
 * スキーマは npm run schema:fetch で取得する。無ければスキップする
 * (貢献者に 8MB のダウンロードを強制しない)。CI は取得ステップを
 * 明示的に実行するので、スキップ任せで腐ることはない。
 */

const ready = schemaAvailable() && xmllintAvailable()
const withSchema = ready ? describe : describe.skip

if (!ready) {
  console.warn('XSD が無いためスキーマ検証をスキップします (npm run schema:fetch)')
}

/**
 * 違反の見分け用の鍵。行番号やファイル名を落として本質だけ残す。
 * 「保存して違反が増えていないか」を比べるために使う。
 */
function signature(message: string): string {
  return message
    .replace(/^[^:]*:\d+:\s*/, '')
    .replace(/\{[^}]*\}/g, '')
    .trim()
}

function violations(bytes: Uint8Array, label: string): string[] {
  return validateDocx(bytes, label)
    .slice(1)
    .map((p) => signature(p.message))
    .filter((m) => m.length > 0 && !/fails to validate$/.test(m))
    .sort()
}

withSchema('ECMA-376 スキーマ検証', () => {
  /**
   * 元のフィクスチャに既にある違反。理由ごとここに書いて許容する。
   * 黙って無視はしない。
   *
   * - 02-formatting.docx: 生成元ライブラリ (docx@9.7.1) が w:highlightCs を吐く。
   *   この要素は ECMA-376 の CT_RPr に無い。Wowd の問題ではない
   * - 11-hostile.docx: 未知要素が原文のまま往復することを確かめるための
   *   フィクスチャ。規格違反なのは意図したとおり
   */
  const KNOWN: Record<string, RegExp> = {
    '02-formatting.docx': /highlightCs/,
    '11-hostile.docx': /someUnknownElement/
  }

  it('元のフィクスチャの違反は既知のものだけ', () => {
    // 元が不合格なら、それはフィクスチャ側の不備。
    // Wowd の出力を責める前にここで切り分ける
    for (const name of fixtureNames()) {
      const found = violations(readFixture(name), name)
      const allowed = KNOWN[name]
      const unexpected = allowed ? found.filter((m) => !allowed.test(m)) : found
      expect(unexpected, `${name} (元) に未知の違反`).toEqual([])
    }
  }, 180_000)

  it('保存しても違反が増えない', () => {
    // 「違反ゼロ」ではなく「元より増えない」が正しい契約。
    // Wowd は未対応の要素を原文のまま書き戻すので、
    // 元が規格外なら出力も規格外になる。それは忠実さであって不具合ではない。
    // 罰すると「規格に合わせるために中身を捨てる」方向に歪む
    for (const name of fixtureNames()) {
      const source = readFixture(name)
      const before = new Set(violations(source, name))

      const model = readDocx(source, name)
      const saved = writeDocx(model, model.pkg, {
        headersChanged: true,
        commentsChanged: true,
        numberingChanged: true
      })
      const added = violations(saved, name).filter((m) => !before.has(m))

      expect(added, `${name}: 保存で違反が増えた`).toEqual([])
    }
  }, 180_000)
})

describe('MCE の前処理', () => {
  const sample =
    '<?xml version="1.0"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'mc:Ignorable="w14">' +
    '<w:body><w:p w14:paraId="12345678"><w:r><w:t>本文</w:t></w:r>' +
    '<w14:someExtension/></w:p></w:body></w:document>'

  it('mc:Ignorable に挙がった接頭辞を読む', () => {
    expect(ignoredPrefixesOf(sample)).toEqual(['mc', 'w14'])
  })

  it('拡張の属性を落とす', () => {
    // ECMA-376 の CT_P は任意属性を許さないので、
    // w14:paraId を残したまま当てると正しいファイルが不合格になる
    expect(sample).toContain('w14:paraId')
    expect(stripIgnorableMarkup(sample)).not.toContain('w14:paraId')
  })

  it('拡張の要素を落とす', () => {
    expect(countElements(sample, 'w14:someExtension')).toBe(1)
    expect(countElements(stripIgnorableMarkup(sample), 'w14:someExtension')).toBe(0)
  })

  it('拡張の名前空間宣言も落とす', () => {
    const out = stripIgnorableMarkup(sample)
    expect(out).not.toContain('xmlns:w14')
    expect(out).not.toContain('mc:Ignorable')
  })

  it('本文には手を付けない', () => {
    const out = stripIgnorableMarkup(sample)
    expect(out).toContain('本文')
    expect(out).toContain('xmlns:w=')
    expect(countElements(out, 'w:p')).toBe(1)
  })

  it('mc:Ignorable が無ければ mc 以外は何も落とさない', () => {
    const plain =
      '<w:document xmlns:w="x" xmlns:w14="y"><w:body><w:p w14:paraId="1"/></w:body></w:document>'
    expect(stripIgnorableMarkup(plain)).toContain('w14:paraId')
  })

  it('壊れた XML でも落ちない', () => {
    expect(() => stripIgnorableMarkup('<w:document><w:body><w:p>')).not.toThrow()
    expect(() => stripIgnorableMarkup('')).not.toThrow()
  })
})
