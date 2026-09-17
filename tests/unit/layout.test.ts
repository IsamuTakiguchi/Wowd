import { describe, it, expect } from 'vitest'
import { pageGeometry, pickHeaderFooterRef, toPx } from '@core/layout/pageGeometry'
import {
  gridFromSection,
  docGridFor,
  docGridForLinesOnly,
  gridLimits,
  manuscriptCell,
  CHAR_SPACE_UNIT
} from '@core/layout/grid'
import { defaultSection } from '@core/docx/read/section'
import { readDocx } from '@core/docx/read'
import { readFixture } from './helpers'
import type { SectionProps } from '@core/model/types'
import { mmToTwip } from '@shared/units'

function a4(over: Partial<SectionProps> = {}): SectionProps {
  return { ...defaultSection('s1'), ...over }
}

describe('pageGeometry', () => {
  it('本文領域は用紙から余白を引いたもの', () => {
    const g = pageGeometry(a4())
    // A4 = 11906 x 16838 twip、余白は上下左右 1440
    expect(g.textInline).toBe(11906 - 1440 - 1440)
    expect(g.textBlock).toBe(16838 - 1440 - 1440)
  })

  it('綴じ代は本文領域を狭める', () => {
    const base = pageGeometry(a4())
    const withGutter = pageGeometry(
      a4({ pgMar: { ...defaultSection('s1').pgMar, gutter: 720 } })
    )
    expect(withGutter.textInline).toBe(base.textInline - 720)
    expect(withGutter.marginStart).toBe(base.marginStart + 720)
  })

  it('余白が用紙より大きくても負にならない', () => {
    const g = pageGeometry(
      a4({ pgMar: { ...defaultSection('s1').pgMar, left: 99999, right: 99999 } })
    )
    expect(g.textInline).toBe(0)
  })

  it('px 変換は 1pt = 96/72 px', () => {
    const px = toPx(pageGeometry(a4()))
    // A4 の幅 11906 twip = 595.3pt = 793.7px
    expect(px.pageInline).toBeGreaterThan(790)
    expect(px.pageInline).toBeLessThan(795)
  })
})

describe('pickHeaderFooterRef', () => {
  const refs = { default: 'rId1', first: 'rId2', even: 'rId3' }

  it('titlePg が真なら 1 ページ目は first', () => {
    expect(pickHeaderFooterRef(refs, 1, true, false)).toBe('rId2')
    expect(pickHeaderFooterRef(refs, 2, true, false)).toBe('rId1')
  })

  it('titlePg が偽なら 1 ページ目も default', () => {
    expect(pickHeaderFooterRef(refs, 1, false, false)).toBe('rId1')
  })

  it('奇数偶数が有効なら偶数ページは even', () => {
    expect(pickHeaderFooterRef(refs, 2, false, true)).toBe('rId3')
    expect(pickHeaderFooterRef(refs, 3, false, true)).toBe('rId1')
  })

  it('指定された種別が無ければ default に落ちる', () => {
    expect(pickHeaderFooterRef({ default: 'rId1' }, 1, true, true)).toBe('rId1')
  })

  it('default も無ければ null', () => {
    expect(pickHeaderFooterRef({}, 1, false, false)).toBeNull()
  })
})

describe('gridFromSection', () => {
  it('docGrid が無ければ null', () => {
    expect(gridFromSection(a4(), 21)).toBeNull()
  })

  it('type が default / 未指定ならグリッドなし', () => {
    expect(
      gridFromSection(a4({ docGrid: { type: 'default', linePitch: 360, charSpace: 0 } }), 21)
    ).toBeNull()
    expect(
      gridFromSection(a4({ docGrid: { type: null, linePitch: 360, charSpace: 0 } }), 21)
    ).toBeNull()
  })

  it('lines なら行数だけが出る', () => {
    const m = gridFromSection(a4({ docGrid: { type: 'lines', linePitch: 360, charSpace: 0 } }), 21)
    expect(m).not.toBeNull()
    expect(m!.charGridEnabled).toBe(false)
    expect(m!.charsPerLine).toBe(0)
    // 本文高 13958 twip = 697.9pt、行送り 18pt → 38 行
    expect(m!.linesPerPage).toBe(38)
  })

  it('Microsoft の文書化された例と一致する (11pt 標準 / 21pt 送り → charSpace 40960)', () => {
    const charSpace = (21 - 11) * CHAR_SPACE_UNIT
    expect(charSpace).toBe(40960)
    const m = gridFromSection(
      a4({ docGrid: { type: 'linesAndChars', linePitch: 360, charSpace } }),
      22 // 11pt
    )
    expect(m!.charPitchPt).toBeCloseTo(21, 6)
  })

  it('charSpace が 0 なら文字送りは標準フォントサイズそのもの', () => {
    const m = gridFromSection(
      a4({ docGrid: { type: 'linesAndChars', linePitch: 360, charSpace: 0 } }),
      21
    )
    expect(m!.charPitchPt).toBeCloseTo(10.5, 6)
  })

  it('charSpace は負にもなる (文字を詰める指定)', () => {
    const m = gridFromSection(
      a4({ docGrid: { type: 'linesAndChars', linePitch: 360, charSpace: -4096 } }),
      21
    )
    expect(m!.charPitchPt).toBeCloseTo(9.5, 6)
  })
})

describe('docGridFor (逆変換)', () => {
  it('40 字 × 36 行を指定して読み戻すと同じ値になる', () => {
    const b5 = a4({
      pgSz: { w: mmToTwip(182), h: mmToTwip(257), orient: null },
      pgMar: { top: 1440, bottom: 1440, left: 1701, right: 1701, header: 851, footer: 992, gutter: 0 }
    })
    const grid = docGridFor(b5, 21, 40, 36)
    const metrics = gridFromSection({ ...b5, docGrid: grid }, 21)

    expect(metrics!.charsPerLine).toBe(40)
    expect(metrics!.linesPerPage).toBe(36)
  })

  it('往復してもずれない (A4 で 30 字 × 25 行)', () => {
    const section = a4()
    const grid = docGridFor(section, 21, 30, 25)
    const metrics = gridFromSection({ ...section, docGrid: grid }, 21)
    expect(metrics!.charsPerLine).toBe(30)
    expect(metrics!.linesPerPage).toBe(25)
  })

  it('文字数 0 を渡すと行グリッドだけになる', () => {
    const grid = docGridFor(a4(), 21, 0, 40)
    expect(grid.type).toBe('lines')
  })

  it('行数だけの指定', () => {
    const grid = docGridForLinesOnly(a4(), 20)
    expect(grid.type).toBe('lines')
    const metrics = gridFromSection({ ...a4(), docGrid: grid }, 21)
    expect(metrics!.linesPerPage).toBe(20)
  })
})

describe('gridLimits', () => {
  it('上限は用紙サイズから決まる', () => {
    const limits = gridLimits(a4(), 21)
    expect(limits.maxCharsPerLine).toBeGreaterThan(40)
    expect(limits.maxLinesPerPage).toBeGreaterThan(36)
  })

  it('上限は必ず 1 以上 (余白が用紙を食い潰しても壊れない)', () => {
    const limits = gridLimits(
      a4({ pgMar: { ...defaultSection('s').pgMar, left: 99999, right: 99999 } }),
      21
    )
    expect(limits.maxCharsPerLine).toBeGreaterThanOrEqual(1)
  })
})

describe('manuscriptCell', () => {
  it('文字グリッドが有効ならマス目の実寸が出る', () => {
    const m = gridFromSection(
      a4({ docGrid: { type: 'linesAndChars', linePitch: 360, charSpace: 0 } }),
      21
    )
    const cell = manuscriptCell(m)
    expect(cell!.widthPt).toBeCloseTo(10.5, 6)
    expect(cell!.heightPt).toBeCloseTo(18, 6)
  })

  it('行グリッドだけならマス目は出ない', () => {
    const m = gridFromSection(a4({ docGrid: { type: 'lines', linePitch: 360, charSpace: 0 } }), 21)
    expect(manuscriptCell(m)).toBeNull()
    expect(manuscriptCell(null)).toBeNull()
  })
})

describe('実ファイルのセクション', () => {
  it('A4 文書の本文領域が妥当な大きさになる', () => {
    const { resources } = readDocx(readFixture('03-styles.docx'))
    const g = pageGeometry(resources.sections[0]!)
    expect(g.textInline).toBeGreaterThan(0)
    expect(g.textBlock).toBeGreaterThan(0)
    expect(g.textInline).toBeLessThan(g.pageInline)
  })
})
