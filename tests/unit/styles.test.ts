import { describe, it, expect } from 'vitest'
import { readDocx } from '@core/docx/read'
import { effectiveParagraphProps, effectiveRunProps, resolveStyleChain } from '@core/docx/read/styles'
import { buildStyleSheet } from '@core/css/styleSheet'
import { runPropsToStyle, fontsToCss, DEFAULT_RUN_PROPS } from '@core/css/runCss'
import { paragraphAttrsToStyle } from '@core/css/paragraphCss'
import { readFixture } from './helpers'

describe('fontsToCss', () => {
  it('和欧混植は欧文フォントを先に積む', () => {
    expect(fontsToCss({ ascii: 'Century', eastAsia: 'ＭＳ 明朝', hAnsi: 'Century' })).toBe(
      'Century, "ＭＳ 明朝"'
    )
  })

  it('hint="eastAsia" なら和文フォントを先に積む', () => {
    // 曖昧な字を和文フォントで出すという指定なので順序を入れ替える
    expect(fontsToCss({ ascii: 'Century', eastAsia: '游明朝', hint: 'eastAsia' })).toBe(
      '游明朝, Century'
    )
  })

  it('空白を含むフォント名は引用符で囲む', () => {
    expect(fontsToCss({ ascii: 'Times New Roman' })).toBe('"Times New Roman"')
  })

  it('指定が無ければ null', () => {
    expect(fontsToCss(null)).toBeNull()
    expect(fontsToCss({})).toBeNull()
  })
})

describe('runPropsToStyle', () => {
  it('サイズは half-point から pt へ', () => {
    expect(runPropsToStyle({ ...DEFAULT_RUN_PROPS, sz: 21 })).toContain('font-size:10.5pt')
  })

  it('色は # を付ける。auto は色指定にしない', () => {
    expect(runPropsToStyle({ ...DEFAULT_RUN_PROPS, color: 'FF0000' })).toContain('color:#FF0000')
    expect(runPropsToStyle({ ...DEFAULT_RUN_PROPS, color: 'auto' })).not.toContain('color:')
  })

  it('上付きは vertical-align になる', () => {
    expect(runPropsToStyle({ ...DEFAULT_RUN_PROPS, vertAlign: 'superscript' })).toContain(
      'vertical-align:super'
    )
  })

  it('文字間隔は twip から pt へ', () => {
    expect(runPropsToStyle({ ...DEFAULT_RUN_PROPS, spacing: 20 })).toContain('letter-spacing:1pt')
  })

  it('何も指定が無ければ空文字', () => {
    expect(runPropsToStyle(DEFAULT_RUN_PROPS)).toBe('')
  })
})

describe('paragraphAttrsToStyle', () => {
  it('両端揃えは justify', () => {
    expect(paragraphAttrsToStyle({ jc: 'both' })).toContain('text-align:justify')
  })

  it('均等割り付けは最終行も揃える', () => {
    const css = paragraphAttrsToStyle({ jc: 'distribute' })
    expect(css).toContain('text-align-last:justify')
  })

  it('行間 auto は倍率になる (240 = 1 行)', () => {
    expect(paragraphAttrsToStyle({ spacing: { line: 360, lineRule: 'auto' } })).toContain(
      'line-height:1.5'
    )
  })

  it('行間 exact は実寸になる', () => {
    expect(paragraphAttrsToStyle({ spacing: { line: 360, lineRule: 'exact' } })).toContain(
      'line-height:18pt'
    )
  })

  it('日本語の *Chars 指定は em に写し、twip より優先される', () => {
    const css = paragraphAttrsToStyle({ ind: { left: 720, leftChars: 200 } })
    expect(css).toContain('margin-inline-start:2em')
    expect(css).not.toContain('36pt')
  })

  it('ぶら下げインデントは負の text-indent', () => {
    expect(paragraphAttrsToStyle({ ind: { left: 720, hanging: 360 } })).toContain(
      'text-indent:-18pt'
    )
  })
})

describe('スタイルの継承解決', () => {
  it('basedOn を辿って連鎖を作る', () => {
    const { resources } = readDocx(readFixture('03-styles.docx'))
    const chain = resolveStyleChain(resources.styles, 'Heading1')
    expect(chain.length).toBeGreaterThan(0)
    expect(chain[chain.length - 1]?.styleId).toBe('Heading1')
  })

  it('循環参照する定義でも止まる', () => {
    const { resources } = readDocx(readFixture('03-styles.docx'))
    const styles = resources.styles
    // わざと自分自身を basedOn にする
    const heading = styles.byId.get('Heading1')
    if (heading) styles.byId.set('Heading1', { ...heading, basedOn: 'Heading1' })
    expect(() => resolveStyleChain(styles, 'Heading1')).not.toThrow()
    expect(resolveStyleChain(styles, 'Heading1')).toHaveLength(1)
  })

  it('実効書式に docDefaults が効く', () => {
    const { resources } = readDocx(readFixture('05-kitchen-sink.docx'))
    const rPr = effectiveRunProps(resources.styles, 'Normal')
    // テンプレートで既定サイズを指定しているので何らかの値が入る
    expect(rPr).toBeTypeOf('object')
    const pPr = effectiveParagraphProps(resources.styles, 'Heading1')
    expect(pPr).toBeTypeOf('object')
  })
})

describe('buildStyleSheet', () => {
  it('段落スタイルごとに data-style セレクタを出す', () => {
    const { resources } = readDocx(readFixture('05-kitchen-sink.docx'))
    const css = buildStyleSheet(resources.styles)
    expect(css).toContain('[data-style="Heading1"]')
    expect(css).toContain('[data-style="Title"]')
  })

  it('ブラウザ既定の見出しサイズを打ち消す', () => {
    const { resources } = readDocx(readFixture('05-kitchen-sink.docx'))
    const css = buildStyleSheet(resources.styles)
    // これが無いと styles.xml の指定より h1 の既定サイズが勝ってしまう
    expect(css).toContain('font-size:inherit')
  })

  it('見出しに実際のサイズ指定が入る', () => {
    const { resources } = readDocx(readFixture('05-kitchen-sink.docx'))
    const css = buildStyleSheet(resources.styles)
    const rule = css.split('\n').find((line: string) => line.includes('[data-style="Heading1"]'))
    expect(rule, 'Heading1 の規則が無い').toBeDefined()
    expect(rule).toMatch(/font-size:[\d.]+pt/)
  })

  it('スコープを変えられる', () => {
    const { resources } = readDocx(readFixture('01-plain.docx'))
    expect(buildStyleSheet(resources.styles, '.preview')).toContain('.preview [data-style=')
  })
})
