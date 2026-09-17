import { describe, it, expect } from 'vitest'
import { buildPrintHtml, type PrintPage } from '@core/css/printHtml'
import { computeListMarkers } from '@core/numbering/markers'
import { ensureListDefinition } from '@core/numbering/create'
import { emptyNumberingTable } from '@core/numbering/resolve'
import { readDocx } from '@core/docx/read'
import { readFixture } from './helpers'
import { defaultSection } from '@core/docx/read/section'
import { emptyStyleTable } from '@core/docx/read/styles'
import { EMPTY_PARAGRAPH_ATTRS } from '@core/docx/read/paragraph'
import type { BlockNode, WowdDoc } from '@core/model/types'

function para(text: string, attrs: Partial<typeof EMPTY_PARAGRAPH_ATTRS> = {}): BlockNode {
  return {
    type: 'paragraph',
    attrs: { ...EMPTY_PARAGRAPH_ATTRS, ...attrs },
    content: [{ type: 'text', text }]
  }
}

function pageOf(...blocks: BlockNode[]): PrintPage {
  return { displayNumber: 1, section: defaultSection('sect1'), blocks }
}

describe('computeListMarkers', () => {
  it('番号を順に振る', () => {
    const table = emptyNumberingTable()
    const { numId } = ensureListDefinition(table, 'decimal')
    const markers = computeListMarkers(
      [{ numPr: { numId, ilvl: 0 } }, { numPr: { numId, ilvl: 0 } }, { numPr: null }],
      table
    )
    expect(markers.get(0)?.text).toBe('1.')
    expect(markers.get(1)?.text).toBe('2.')
    expect(markers.has(2)).toBe(false)
  })

  it('浅いレベルに戻ったら深いレベルの番号をリセットする', () => {
    const table = emptyNumberingTable()
    const { numId } = ensureListDefinition(table, 'decimal')
    const markers = computeListMarkers(
      [
        { numPr: { numId, ilvl: 0 } }, // 1.
        { numPr: { numId, ilvl: 1 } }, // ①
        { numPr: { numId, ilvl: 1 } }, // ②
        { numPr: { numId, ilvl: 0 } }, // 2.
        { numPr: { numId, ilvl: 1 } } // ① に戻る
      ],
      table
    )
    expect(markers.get(0)?.text).toBe('1.')
    expect(markers.get(3)?.text).toBe('2.')
    expect(markers.get(4)?.text).toBe(markers.get(1)?.text)
  })

  it('箇条書きは記号をそのまま使う', () => {
    const table = emptyNumberingTable()
    const { numId } = ensureListDefinition(table, 'bullet')
    const markers = computeListMarkers([{ numPr: { numId, ilvl: 0 } }], table)
    expect(markers.get(0)?.text).toBe('●')
  })

  it('定義が無ければ記号を出さない', () => {
    expect(computeListMarkers([{ numPr: { numId: 9, ilvl: 0 } }], null).size).toBe(0)
    expect(computeListMarkers([{ numPr: { numId: 9, ilvl: 0 } }], emptyNumberingTable()).size).toBe(
      0
    )
  })
})

describe('buildPrintHtml', () => {
  const styles = emptyStyleTable()
  const empty = { headers: new Map<string, WowdDoc>(), footers: new Map<string, WowdDoc>() }

  it('1 ページ 1 div で出力する', () => {
    const html = buildPrintHtml({
      pages: [pageOf(para('1ページ目')), pageOf(para('2ページ目'))],
      styles,
      ...empty,
      title: 'テスト'
    })
    expect(html.match(/class="wowd-print-page"/g)).toHaveLength(2)
    expect(html).toContain('1ページ目')
    expect(html).toContain('2ページ目')
  })

  it('用紙サイズを mm で指定する', () => {
    const html = buildPrintHtml({ pages: [pageOf(para('本文'))], styles, ...empty, title: 'x' })
    // pt だと @page と div の丸めがずれて余りページが出る
    expect(html).toMatch(/@page \w+ \{ size: [\d.]+mm [\d.]+mm; margin: 0 \}/)
    // div 側も同じ mm で指定していないと 1 枚ごとに余りページが出る
    expect(html).toMatch(/\.wowd-print-page\[data-section="sect1"\][^}]*width: [\d.]+mm/)
  })

  it('改ページ指定を CSS に出さない', () => {
    // こちらが改ページを決めているので、break-* を出すと
    // Chromium が上から重ねて改ページしてしまう
    const html = buildPrintHtml({
      pages: [pageOf(para('本文', { pageBreakBefore: true, keepNext: true }))],
      styles,
      ...empty,
      title: 'x'
    })
    const body = html.slice(html.indexOf('<body>'))
    expect(body).not.toContain('break-before')
    expect(body).not.toContain('break-after')
  })

  it('見出しスタイルは見出しタグで出す', () => {
    const html = buildPrintHtml({
      pages: [pageOf(para('章題', { pStyle: 'Heading1' }))],
      styles,
      ...empty,
      title: 'x'
    })
    expect(html).toContain('<h1 data-style="Heading1">')
  })

  it('リストの行頭記号を出す', () => {
    const table = emptyNumberingTable()
    const { numId } = ensureListDefinition(table, 'decimal')
    const html = buildPrintHtml({
      pages: [pageOf(para('項目', { numPr: { numId, ilvl: 0 } }))],
      styles,
      ...empty,
      numbering: table,
      title: 'x'
    })
    expect(html).toContain('wowd-list-marker')
    expect(html).toContain('1.')
  })

  it('ページ番号フィールドをページごとに解決する', () => {
    const footer: WowdDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { ...EMPTY_PARAGRAPH_ATTRS },
          content: [
            { type: 'field', attrs: { instr: 'PAGE', cachedText: '9', dirty: false } },
            { type: 'text', text: ' / ' },
            { type: 'field', attrs: { instr: 'NUMPAGES', cachedText: '9', dirty: false } }
          ]
        }
      ]
    }
    const section = { ...defaultSection('sect1'), footerRefs: { default: 'rId1' } }
    const html = buildPrintHtml({
      pages: [
        { displayNumber: 1, section, blocks: [para('a')] },
        { displayNumber: 2, section, blocks: [para('b')] }
      ],
      styles,
      headers: new Map(),
      footers: new Map([['rId1', footer]]),
      title: 'x'
    })
    // キャッシュ値の 9 ではなく、実際のページ番号が出る
    expect(html).toContain('1 / 2')
    expect(html).toContain('2 / 2')
    expect(html).not.toContain('9 / 9')
  })

  it('HTML として危険な文字を escape する', () => {
    const html = buildPrintHtml({
      pages: [pageOf(para('<script>alert(1)</script> & "quoted"'))],
      styles,
      ...empty,
      title: '<title>'
    })
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
  })

  it('外部参照を含まない自己完結した文書になる', () => {
    const { doc, resources } = readDocx(readFixture('05-kitchen-sink.docx'))
    const html = buildPrintHtml({
      pages: [{ displayNumber: 1, section: resources.sections[0]!, blocks: doc.content }],
      styles: resources.styles,
      headers: resources.headers,
      footers: resources.footers,
      numbering: resources.numbering,
      title: '契約書'
    })
    // 印刷用文書はネットワークにもディスクにもアクセスしない
    expect(html).not.toMatch(/src="https?:/)
    expect(html).not.toMatch(/src="file:/)
    expect(html).not.toContain('<script')
    expect(html).toContain('総合テスト文書')
  })

  it('実ファイルの本文を落とさない', () => {
    const { doc, resources } = readDocx(readFixture('05-kitchen-sink.docx'))
    const html = buildPrintHtml({
      pages: [{ displayNumber: 1, section: resources.sections[0]!, blocks: doc.content }],
      styles: resources.styles,
      headers: resources.headers,
      footers: resources.footers,
      numbering: resources.numbering,
      title: 'x'
    })
    for (const expected of ['総合テスト文書', '見出し 1', '和文', '番号項目', '末尾の段落。']) {
      expect(html, `${expected} が欠けている`).toContain(expected)
    }
  })
})
