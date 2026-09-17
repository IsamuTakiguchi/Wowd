import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { parseXml, tagOf, childrenOf, type XNode } from '@core/docx/xml'
import {
  PPR_ORDER,
  RPR_ORDER,
  SECTPR_ORDER,
  TBLPR_ORDER,
  TCPR_ORDER,
  emitOrdered
} from '@core/docx/write/order'
import { fixtureNames, readFixture } from './helpers'

/**
 * WML の子要素順序。
 *
 * ECMA-376 の CT_PPr / CT_RPr / CT_SectPr などは xsd:sequence なので、
 * 順序を誤ったファイルは Word が「問題を修復しますか」を出す。
 *
 * この壊れ方は往復テストでは**原理的に検出できない**。
 * 読み直したモデルは順序が違っても同じになるため。
 * 実際に w:headerReference が順序テーブルから漏れていて、
 * ヘッダーを持つ全文書が規定違反の順序で書き出されていた。
 */

/** 保存後の document.xml */
function savedDocumentXml(name: string): string {
  const model = readDocx(readFixture(name), name)
  const saved = writeDocx(model, model.pkg, { headersChanged: true })
  const part = unzipSync(saved)[model.resources.documentPartName]
  if (!part) throw new Error(`${name}: document.xml が無い`)
  return strFromU8(part)
}

/** 木を歩いて、指定タグのノードを全部集める */
function collect(nodes: XNode[], tag: string, out: XNode[] = []): XNode[] {
  for (const node of nodes) {
    if (tagOf(node) === tag) out.push(node)
    collect(childrenOf(node), tag, out)
  }
  return out
}

/**
 * 子要素の並びが順序テーブルどおりかを確かめる。
 *
 * テーブルに載っていないタグは見ない。原文のまま退避した未知要素は
 * 末尾に流す仕様で、そこは規定順を保証できないため。
 */
function orderViolations(container: XNode, order: string[]): string[] {
  const rank = new Map(order.map((tag, i) => [tag, i]))
  const seen: { tag: string; rank: number }[] = []
  for (const child of childrenOf(container)) {
    const r = rank.get(tagOf(child))
    if (r != null) seen.push({ tag: tagOf(child), rank: r })
  }

  const bad: string[] = []
  for (let i = 1; i < seen.length; i++) {
    const prev = seen[i - 1]!
    const cur = seen[i]!
    if (cur.rank < prev.rank) bad.push(`${prev.tag} の後に ${cur.tag}`)
  }
  return bad
}

/**
 * 段落記号の rPr (CT_ParaRPr) は、通常の rPr の前に w:ins / w:del が来る。
 * 段落記号そのものの挿入・削除を表す要素で、CT_RPr には無い。
 */
const PARA_RPR_ORDER = ['w:ins', 'w:del', ...RPR_ORDER]

describe('WML の子要素順序', () => {
  const CONTAINERS: { tag: string; order: string[] }[] = [
    { tag: 'w:sectPr', order: SECTPR_ORDER },
    { tag: 'w:pPr', order: PPR_ORDER },
    { tag: 'w:tblPr', order: TBLPR_ORDER },
    { tag: 'w:tcPr', order: TCPR_ORDER }
  ]

  it('全フィクスチャの出力が規定順を守る', () => {
    for (const name of fixtureNames()) {
      const tree = parseXml(savedDocumentXml(name))
      for (const { tag, order } of CONTAINERS) {
        for (const container of collect(tree, tag)) {
          const bad = orderViolations(container, order)
          expect(bad, `${name}: ${tag} の順序が逆 (${bad.join(', ')})`).toEqual([])
        }
      }

      // rPr は置かれた場所で規定が変わる。段落記号のものだけ ins/del を許す
      for (const pPr of collect(tree, 'w:pPr')) {
        for (const rPr of childrenOf(pPr).filter((n) => tagOf(n) === 'w:rPr')) {
          expect(orderViolations(rPr, PARA_RPR_ORDER), `${name}: 段落記号の w:rPr`).toEqual([])
        }
      }
    }
  })

  it('ヘッダーの参照が sectPr の先頭側に出る', () => {
    // CT_SectPr は headerReference / footerReference が sequence の先頭。
    // 後ろに置くとヘッダーを持つ全文書が Word の修復対象になる
    const xml = savedDocumentXml('15-headers.docx')
    const sectPrs = collect(parseXml(xml), 'w:sectPr')
    const withRef = sectPrs.filter((s) =>
      childrenOf(s).some((c) => tagOf(c) === 'w:headerReference')
    )
    expect(withRef.length, 'ヘッダー参照を持つ sectPr が無い').toBeGreaterThan(0)

    for (const sectPr of withRef) {
      const tags = childrenOf(sectPr).map(tagOf)
      const firstRef = tags.indexOf('w:headerReference')
      const pgSz = tags.indexOf('w:pgSz')
      expect(pgSz, 'w:pgSz が無い').toBeGreaterThanOrEqual(0)
      expect(firstRef, 'w:headerReference が w:pgSz より後ろにある').toBeLessThan(pgSz)
    }
  })
})

describe('順序テーブルの取りこぼし検出', () => {
  it('テーブルに無いタグをモデルが出そうとしたら落とす', () => {
    // 黙って末尾に回すと、規定違反のまま出力されて Word が開けなくなる。
    // しかもその壊れ方は往復テストでは検出できないので、ここで止める
    expect(() =>
      emitOrdered(['w:pgSz'], [{ tag: 'w:知らない要素', xml: '<w:知らない要素/>' }], 'w:sectPr')
    ).toThrow(/w:知らない要素/)
  })

  it('原文のまま退避した断片は落とさず末尾に流す', () => {
    // 元ファイル由来の未知要素は、順序を保証できなくても落とさない方が大事
    const out = emitOrdered(
      ['w:pgSz'],
      [
        { tag: 'w:vendorExt', xml: '<w:vendorExt/>', raw: true },
        { tag: 'w:pgSz', xml: '<w:pgSz/>' }
      ],
      'w:sectPr'
    )
    expect(out).toBe('<w:pgSz/><w:vendorExt/>')
  })

  it('テーブルに載っていれば、原文由来でも規定位置に並べ直す', () => {
    // Word が普通に吐く w:widowControl などは rawPPr 経由で来るが、
    // テーブルに載っているので正しい位置に入る
    const out = emitOrdered(
      ['w:pStyle', 'w:widowControl', 'w:jc'],
      [
        { tag: 'w:jc', xml: '<w:jc/>' },
        { tag: 'w:widowControl', xml: '<w:widowControl/>', raw: true },
        { tag: 'w:pStyle', xml: '<w:pStyle/>' }
      ],
      'w:pPr'
    )
    expect(out).toBe('<w:pStyle/><w:widowControl/><w:jc/>')
  })
})
