import { describe, it, expect } from 'vitest'
import { effectiveNumPr } from '@core/numbering/effective'
import { computeListMarkers } from '@core/numbering/markers'
import { markerCss } from '@core/numbering/markerCss'
import { ensureListDefinition } from '@core/numbering/create'
import { emptyNumberingTable, resolveLevel } from '@core/numbering/resolve'
import { emptyStyleTable, readStyles } from '@core/docx/read/styles'
import { readNumbering } from '@core/docx/read/numbering'
import { writeStyles, writeStyle } from '@core/docx/write/styles'
import { writeNumbering } from '@core/docx/write/numbering'
import { buildPrintHtml, type PrintPage } from '@core/css/printHtml'
import { defaultSection } from '@core/docx/read/section'
import { EMPTY_PARAGRAPH_ATTRS } from '@core/docx/read/paragraph'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import type { BlockNode, StyleDef, StyleTable, NumberingTable, WowdDoc } from '@core/model/types'
import { readFixture } from './helpers'

function style(styleId: string, extra: Partial<StyleDef> = {}): StyleDef {
  return {
    styleId,
    type: 'paragraph',
    name: styleId,
    basedOn: null,
    next: null,
    linkedStyle: null,
    isDefault: false,
    quickFormat: true,
    uiPriority: 99,
    semiHidden: false,
    custom: true,
    pPr: null,
    rPr: null,
    rawXml: '',
    ...extra
  }
}

function tableWith(...defs: StyleDef[]): StyleTable {
  const table = emptyStyleTable()
  for (const def of defs) table.byId.set(def.styleId, def)
  return table
}

/** 9 レベルの段落番号定義に、レベル 0〜2 をスタイルに結び付けた番号を作る */
function linkedNumbering(): { table: NumberingTable; numId: number } {
  const table = emptyNumberingTable()
  const { numId } = ensureListDefinition(table, 'decimal')
  const abstract = table.abstract.get(table.instances.get(numId)!.abstractNumId)!
  for (const [ilvl, level] of abstract.levels) {
    if (ilvl < 3) abstract.levels.set(ilvl, { ...level, pStyle: `Rank${ilvl + 1}` })
  }
  return { table, numId }
}

function para(text: string, attrs: Partial<typeof EMPTY_PARAGRAPH_ATTRS> = {}): BlockNode {
  return { type: 'paragraph', attrs: { ...EMPTY_PARAGRAPH_ATTRS, ...attrs }, content: [{ type: 'text', text }] }
}

describe('effectiveNumPr (スタイル経由の番号)', () => {
  it('段落に直接ある numPr が勝つ。numId=0 は番号を外す指定', () => {
    const { table, numId } = linkedNumbering()
    const styles = tableWith(style('Rank1', { pPr: { numPr: { numId, ilvl: 0 } } }))
    expect(effectiveNumPr({ numPr: { numId, ilvl: 4 }, pStyle: 'Rank1' }, styles, table)).toEqual({
      numId,
      ilvl: 4
    })
    expect(effectiveNumPr({ numPr: { numId: 0, ilvl: 0 }, pStyle: 'Rank1' }, styles, table)).toBeNull()
  })

  it('スタイルの numPr を拾い、レベルは w:pStyle が一致するものを使う', () => {
    const { table, numId } = linkedNumbering()
    // スタイル側は ilvl を省くのが普通 (読むと 0 になる)
    const styles = tableWith(style('Rank3', { pPr: { numPr: { numId, ilvl: 0 } } }))
    expect(effectiveNumPr({ numPr: null, pStyle: 'Rank3' }, styles, table)).toEqual({ numId, ilvl: 2 })
  })

  it('basedOn の先にある numPr も拾う', () => {
    const { table, numId } = linkedNumbering()
    const styles = tableWith(
      style('Rank2', { pPr: { numPr: { numId, ilvl: 1 } } }),
      style('Child', { basedOn: 'Rank2' })
    )
    expect(effectiveNumPr({ numPr: null, pStyle: 'Child' }, styles, table)).toEqual({ numId, ilvl: 1 })
  })

  it('スタイルにも番号が無ければ null', () => {
    const { table } = linkedNumbering()
    expect(effectiveNumPr({ numPr: null, pStyle: 'Normal' }, tableWith(style('Normal')), table)).toBeNull()
    expect(effectiveNumPr({ numPr: null, pStyle: null }, null, table)).toBeNull()
  })

  it('computeListMarkers はスタイル経由の段落も数える', () => {
    const { table, numId } = linkedNumbering()
    const styles = tableWith(
      style('Rank1', { pPr: { numPr: { numId, ilvl: 0 } } }),
      style('Rank2', { pPr: { numPr: { numId, ilvl: 1 } } })
    )
    const markers = computeListMarkers(
      [
        { numPr: null, pStyle: 'Rank1' },
        { numPr: null, pStyle: 'Rank2' },
        { numPr: null, pStyle: 'Body' },
        { numPr: null, pStyle: 'Rank2' },
        { numPr: null, pStyle: 'Rank1' }
      ],
      table,
      styles
    )
    expect(markers.get(0)?.text).toBe('1.')
    expect(markers.has(2)).toBe(false)
    expect(markers.get(4)?.text).toBe('2.')
    // 2 つ目の Rank2 は続き番号
    expect(markers.get(3)?.text).not.toBe(markers.get(1)?.text)
  })
})

describe('番号の数え方 (Word と同じ規則)', () => {
  it('同じ定義を指す別の num は番号を引き継ぐ', () => {
    const { table, numId } = linkedNumbering()
    const second = numId + 1
    table.instances.set(second, {
      numId: second,
      abstractNumId: table.instances.get(numId)!.abstractNumId,
      overrides: new Map(),
      rawXml: ''
    })
    const markers = computeListMarkers(
      [{ numPr: { numId, ilvl: 0 } }, { numPr: { numId: second, ilvl: 0 } }],
      table
    )
    expect(markers.get(1)?.text).toBe('2.')
  })

  it('startOverride は振り直したレベルだけ 1 に戻し、上のレベルは続ける (打直し)', () => {
    const { table, numId } = linkedNumbering()
    const restarted = numId + 1
    table.instances.set(restarted, {
      numId: restarted,
      abstractNumId: table.instances.get(numId)!.abstractNumId,
      overrides: new Map([[1, { startOverride: 1, level: null }]]),
      rawXml: ''
    })
    const level1 = resolveLevel(table, numId, 1)!
    const markers = computeListMarkers(
      [
        { numPr: { numId, ilvl: 0 } }, // 1.
        { numPr: { numId, ilvl: 1 } }, // 1 番目
        { numPr: { numId, ilvl: 1 } }, // 2 番目
        { numPr: { numId: restarted, ilvl: 1 } }, // 振り直して 1 番目
        { numPr: { numId: restarted, ilvl: 1 } }, // 2 番目 (もう一度は振り直さない)
        { numPr: { numId: restarted, ilvl: 0 } } // 2. (上のレベルは続き)
      ],
      table
    )
    expect(markers.get(3)?.text).toBe(markers.get(1)?.text)
    expect(markers.get(4)?.text).toBe(markers.get(2)?.text)
    expect(markers.get(5)?.text).toBe('2.')
    expect(level1).not.toBeNull()
  })
})

describe('markerCss (行頭記号の置き方)', () => {
  const base = resolveLevel(linkedNumbering().table, 1, 0)!

  it('右揃えは幅 0 の箱から左へはみ出させ、区切りは外に出す', () => {
    const css = markerCss({ ...base, lvlJc: 'right', suff: 'nothing' })
    expect(css.box).toContain('width:0')
    expect(css.box).toContain('justify-content:flex-end')
    expect(css.suffixOutside).toBe(true)
    expect(css.glyph).toBeNull()
  })

  it('文字の幅 (w:w) は右端を軸に縮める', () => {
    const css = markerCss({ ...base, lvlJc: 'right', rPr: { ...emptyRun(), w: 50 } })
    expect(css.glyph).toContain('scaleX(0.5)')
    expect(css.glyph).toContain('transform-origin:right')
  })

  it('左揃えはぶら下げの幅の箱に入れる (従来どおり)', () => {
    const css = markerCss({ ...base, lvlJc: 'left' })
    expect(css.box).toContain('margin-inline-start:-')
    expect(css.suffixOutside).toBe(false)
  })
})

function emptyRun(): NonNullable<StyleDef['rPr']> {
  return {
    rFonts: null,
    sz: null,
    szCs: null,
    color: null,
    highlight: null,
    shd: null,
    spacing: null,
    w: null,
    kern: null,
    vertAlign: null,
    rStyle: null,
    lang: null,
    rawRPr: null
  }
}

describe('styles.xml の書き出し', () => {
  const original = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Old"><w:name w:val="Old"/></w:style></w:styles>`

  it('既存スタイルは原文のまま、新しいスタイルは末尾に足す', () => {
    const table = readStyles(original)
    table.byId.delete('Old')
    table.byId.set(
      'Rank1',
      style('Rank1', {
        name: 'ランク１',
        basedOn: 'Normal',
        next: 'Body1',
        pPr: { ind: { leftChars: 200, firstLineChars: 0 } as never, outlineLvl: 0, numPr: { numId: 3, ilvl: 0 } }
      })
    )
    const xml = writeStyles(table, original)

    // 原本のルート宣言・docDefaults・既存スタイル (太字を含む) が残る
    expect(xml).toContain('xmlns:w14=')
    expect(xml).toContain('<w:docDefaults>')
    expect(xml).toContain('<w:b/>')
    // 消したスタイルは出さない
    expect(xml).not.toContain('w:styleId="Old"')

    const reread = readStyles(xml)
    const rank = reread.byId.get('Rank1')!
    expect(rank.name).toBe('ランク１')
    expect(rank.basedOn).toBe('Normal')
    expect(rank.next).toBe('Body1')
    expect(rank.custom).toBe(true)
    expect(rank.pPr?.numPr).toEqual({ numId: 3, ilvl: 0 })
    expect(rank.pPr?.outlineLvl).toBe(0)
    expect(rank.pPr?.ind?.leftChars).toBe(200)
    // 部分的な pPr でも「グリッドに合わせない」を勝手に書かない
    expect(xml).not.toContain('w:snapToGrid')
  })

  it('子要素を CT_Style の順に並べる', () => {
    const xml = writeStyle(
      style('X', { basedOn: 'Normal', next: 'Y', linkedStyle: 'XChar', pPr: { jc: 'both' }, rPr: emptyRun() })
    )
    const order = ['w:name', 'w:basedOn', 'w:next', 'w:link', 'w:uiPriority', 'w:qFormat', 'w:pPr'].map((t) =>
      xml.indexOf(`<${t}`)
    )
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]!))).toBe(true)
  })
})

describe('numbering.xml: 振り直し (startOverride) とレベルのスタイル', () => {
  it('lvlOverride と w:pStyle を書き出して読み直せる', () => {
    const { table, numId } = linkedNumbering()
    table.instances.set(numId + 1, {
      numId: numId + 1,
      abstractNumId: table.instances.get(numId)!.abstractNumId,
      overrides: new Map([[2, { startOverride: 1, level: null }]]),
      rawXml: ''
    })
    const reread = readNumbering(writeNumbering(table))
    expect(reread.instances.get(numId + 1)?.overrides.get(2)?.startOverride).toBe(1)
    expect(resolveLevel(reread, numId, 1)?.pStyle).toBe('Rank2')
  })
})

describe('パートが無い文書にも書ける', () => {
  it('numbering.xml の無い .docx に番号を足すと、パート・関係・型を作る', () => {
    const doc = readDocx(readFixture('01-plain.docx'))
    // numbering.xml を持たない文書を作る
    for (const name of [...doc.pkg.parts.keys()]) {
      if (name.endsWith('numbering.xml')) doc.pkg.parts.delete(name)
    }
    const relsName = 'word/_rels/document.xml.rels'
    const rels = new TextDecoder().decode(doc.pkg.parts.get(relsName)!)
    doc.pkg.parts.set(
      relsName,
      new TextEncoder().encode(rels.replace(/<Relationship [^>]*numbering[^>]*\/>/g, ''))
    )

    ensureListDefinition(doc.resources.numbering, 'decimal')
    const saved = writeDocx(doc, doc.pkg, { numberingChanged: true })
    const reread = readDocx(saved)
    expect(reread.resources.numbering.instances.size).toBeGreaterThan(0)
    const types = new TextDecoder().decode(reread.pkg.parts.get('[Content_Types].xml')!)
    expect(types).toContain('/word/numbering.xml')
  })

  it('スタイルを足して保存すると styles.xml に載る', () => {
    const doc = readDocx(readFixture('01-plain.docx'))
    const styles: StyleTable = { ...doc.resources.styles, byId: new Map(doc.resources.styles.byId) }
    styles.byId.set('Rank1', style('Rank1', { name: 'ランク１' }))
    const saved = writeDocx({ ...doc, resources: { ...doc.resources, styles } }, doc.pkg, {
      stylesChanged: true
    })
    const reread = readDocx(saved)
    expect(reread.resources.styles.byId.get('Rank1')?.name).toBe('ランク１')
    // 既存スタイルは減らない
    expect(reread.resources.styles.byId.size).toBe(doc.resources.styles.byId.size + 1)
  })
})

describe('印刷: 番号はページをまたいで続く', () => {
  it('2 ページ目の番号が 1 に戻らない', () => {
    const table = emptyNumberingTable()
    const { numId } = ensureListDefinition(table, 'decimal')
    const page = (n: number, block: BlockNode): PrintPage => ({
      displayNumber: n,
      section: defaultSection('sect1'),
      blocks: [block]
    })
    const html = buildPrintHtml({
      pages: [page(1, para('一', { numPr: { numId, ilvl: 0 } })), page(2, para('二', { numPr: { numId, ilvl: 0 } }))],
      styles: emptyStyleTable(),
      headers: new Map<string, WowdDoc>(),
      footers: new Map<string, WowdDoc>(),
      numbering: table,
      title: 'x'
    })
    expect(html).toContain('>1.\t<')
    expect(html).toContain('>2.\t<')
  })
})
