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
import { twipToMm } from '@shared/units'

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

describe('buildPrintHtml の裁ちトンボ', () => {
  const base = {
    styles: emptyStyleTable(),
    headers: new Map<string, WowdDoc>(),
    footers: new Map<string, WowdDoc>(),
    title: '入稿'
  }

  /** @page の size から mm の数値を取り出す */
  function paperMm(html: string): { w: number; h: number } {
    const m = html.match(/@page [^{]+\{ size: ([\d.]+)mm ([\d.]+)mm/)
    if (!m) throw new Error('@page の size が見つからない')
    return { w: Number(m[1]), h: Number(m[2]) }
  }

  // A4 は 11906 x 16838 twip。mm に直すと 210.01 x 297 で、ちょうど 210mm ではない。
  // 期待値は実寸から出す
  const A4_W = twipToMm(defaultSection('sect1').pgSz.w)
  const A4_H = twipToMm(defaultSection('sect1').pgSz.h)

  it('付けないときは用紙が仕上がりサイズのまま', () => {
    const html = buildPrintHtml({ ...base, pages: [pageOf(para('本文'))] })
    const paper = paperMm(html)
    expect(paper.w).toBeCloseTo(A4_W, 1)
    expect(paper.h).toBeCloseTo(A4_H, 1)
    expect(html).not.toContain('wowd-print-marks')
    expect(html).not.toContain('wowd-print-trim-area')
  })

  it('付けると用紙が四辺 13mm ずつ大きくなる', () => {
    const html = buildPrintHtml({ ...base, pages: [pageOf(para('本文'))], trimMarks: true })
    const paper = paperMm(html)
    expect(paper.w).toBeCloseTo(A4_W + 26, 1)
    expect(paper.h).toBeCloseTo(A4_H + 26, 1)
    // div の寸法も @page と一致していること。ずれると 1 枚ごとに余りページが出る
    expect(html).toContain(`width: ${paper.w}mm; height: ${paper.h}mm`)
  })

  it('本文は仕上がりサイズの枠に入り、その枠が紙の中央に来る', () => {
    const html = buildPrintHtml({ ...base, pages: [pageOf(para('本文'))], trimMarks: true })
    const m = html.match(/class="wowd-print-trim-area" style="([^"]+)"/)
    expect(m, '仕上がりサイズの枠が無い').not.toBeNull()
    const style = m?.[1] ?? ''
    expect(style).toContain('left:13mm')
    expect(style).toContain('top:13mm')
    // 枠の大きさは仕上がりサイズそのもの
    const size = style.match(/width:([\d.]+)mm;height:([\d.]+)mm/)
    expect(Number(size?.[1])).toBeCloseTo(A4_W, 1)
    expect(Number(size?.[2])).toBeCloseTo(A4_H, 1)
  })

  it('トンボの線が SVG で入る', () => {
    const html = buildPrintHtml({ ...base, pages: [pageOf(para('本文'))], trimMarks: true })
    expect(html).toContain('class="wowd-print-marks"')
    expect(html).toContain('<path d="M')
    // 印刷に JavaScript は使えないので、画像でも外部参照でもなく素の SVG であること
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
  })

  it('本文の位置指定はトンボの有無で変わらない (枠ごと動かしているので)', () => {
    const plain = buildPrintHtml({ ...base, pages: [pageOf(para('本文'))] })
    const trimmed = buildPrintHtml({ ...base, pages: [pageOf(para('本文'))], trimMarks: true })
    const bodyStyle = /<div class="wowd-print-body" style="([^"]+)"/
    expect(trimmed.match(bodyStyle)?.[1]).toBe(plain.match(bodyStyle)?.[1])
  })
})
