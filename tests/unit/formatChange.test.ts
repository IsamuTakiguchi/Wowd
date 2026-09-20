import { describe, it, expect } from 'vitest'
import {
  withRunFormatChange,
  withParaFormatChange,
  hasRunFormatChange,
  hasParaFormatChange,
  stripRunFormatChange,
  stripParaFormatChange,
  previousRunProps,
  previousParaProps
} from '@core/revisions/formatChange'
import { DEFAULT_PARAGRAPH_ATTRS } from '@renderer/editor/extensions/paragraphAttrs'
import { DEFAULT_RUN_PROPS } from '@core/css/runCss'
import type { Mark, ParagraphAttrs, RevisionMeta } from '@core/model/types'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { validateDocx, schemaAvailable, xmllintAvailable } from '../../scripts/lib/validateOoxml'
import { readFixture } from './helpers'

const META: RevisionMeta = { id: 10, author: '校閲者A', date: '2026-01-01T00:00:00Z' }
const SECTIONS = new Map()

const bold: Mark = { type: 'bold' }
const sized = (sz: number): Mark => ({
  type: 'textStyle',
  attrs: { ...DEFAULT_RUN_PROPS, sz }
})

describe('文字書式の変更履歴', () => {
  it('変更前の書式を子として抱える', () => {
    const out = withRunFormatChange(null, [bold, sized(24)], META)
    expect(out).toContain('<w:rPrChange ')
    expect(out).toContain('w:author="校閲者A"')
    // CT_RPrChange は子の w:rPr が必須
    expect(out).toMatch(/<w:rPrChange[^>]*><w:rPr>/)
    expect(out).toContain('<w:b/>')
    expect(out).toContain('<w:sz w:val="24"/>')
  })

  it('書式が無かった場合も空の w:rPr を入れる', () => {
    // 子が無いと CT_RPrChange として規格違反になる
    const out = withRunFormatChange(null, [], META)
    expect(out).toMatch(/<w:rPrChange[^>]*><w:rPr><\/w:rPr><\/w:rPrChange>/)
  })

  it('二度目の変更では最初の「変更前」を保つ', () => {
    // w:rPrChange が指すのは「記録を始める前の姿」。
    // 上書きすると、取り消したときに元へ戻らなくなる
    const first = withRunFormatChange(null, [bold], META)
    const second = withRunFormatChange(first, [sized(24)], { ...META, id: 11 })
    expect(second).toBe(first)
    expect(second).toContain('<w:b/>')
    expect(second).not.toContain('<w:sz')
  })

  it('既にある未対応要素を壊さない', () => {
    const raw = '<w:em w:val="dot"/>'
    const out = withRunFormatChange(raw, [bold], META)
    expect(out).toContain('<w:em w:val="dot"/>')
    expect(out).toContain('<w:rPrChange ')
  })

  it('変更前の書式に前の変更履歴を入れ子にしない', () => {
    const previous: Mark[] = [
      { type: 'textStyle', attrs: { ...DEFAULT_RUN_PROPS, rawRPr: '<w:rPrChange w:id="1" w:author="x"><w:rPr/></w:rPrChange>' } }
    ]
    const out = withRunFormatChange(null, previous, META)
    expect((out ?? '').match(/<w:rPrChange/g) ?? []).toHaveLength(1)
  })

  it('取り出しと取り除きができる', () => {
    const out = withRunFormatChange('<w:em w:val="dot"/>', [bold], META)
    expect(hasRunFormatChange(out)).toBe(true)
    expect(previousRunProps(out)).toContain('<w:b/>')
    expect(stripRunFormatChange(out)).toBe('<w:em w:val="dot"/>')
    expect(hasRunFormatChange(stripRunFormatChange(out))).toBe(false)
  })
})

describe('段落書式の変更履歴', () => {
  const attrs = (patch: Partial<ParagraphAttrs>): ParagraphAttrs => ({
    ...DEFAULT_PARAGRAPH_ATTRS,
    ...patch
  })

  it('変更前の段落書式を子として抱える', () => {
    const out = withParaFormatChange(null, attrs({ jc: 'center', pStyle: 'Heading1' }), SECTIONS, META)
    expect(out).toMatch(/<w:pPrChange[^>]*><w:pPr>/)
    expect(out).toContain('<w:jc w:val="center"/>')
    expect(out).toContain('<w:pStyle w:val="Heading1"/>')
  })

  it('CT_PPrBase に入れられないものを持ち込まない', () => {
    // w:rPr / w:sectPr / w:pPrChange は CT_PPrBase に無い。
    // 入れると Word が「問題を修復しますか」を出す
    const previous = attrs({
      jc: 'right',
      markRunProps: { ...DEFAULT_RUN_PROPS, sz: 24 },
      sectionId: 'sect1',
      rawPPr: '<w:pPrChange w:id="1" w:author="x"><w:pPr/></w:pPrChange>'
    })
    const out = withParaFormatChange(null, previous, SECTIONS, META)
    const inner = previousParaProps(out) ?? ''
    expect(inner).not.toContain('<w:rPr')
    expect(inner).not.toContain('<w:sectPr')
    expect(inner).not.toContain('<w:pPrChange')
    expect(inner).toContain('<w:jc w:val="right"/>')
  })

  it('書式が無かった場合も空の w:pPr を入れる', () => {
    const out = withParaFormatChange(null, attrs({}), SECTIONS, META)
    expect(out).toMatch(/<w:pPrChange[^>]*><w:pPr><\/w:pPr><\/w:pPrChange>/)
  })

  it('二度目の変更では最初の「変更前」を保つ', () => {
    const first = withParaFormatChange(null, attrs({ jc: 'center' }), SECTIONS, META)
    const second = withParaFormatChange(first, attrs({ jc: 'right' }), SECTIONS, { ...META, id: 11 })
    expect(second).toBe(first)
    expect(previousParaProps(second)).toContain('center')
  })

  it('取り出しと取り除きができる', () => {
    const out = withParaFormatChange(null, attrs({ jc: 'center' }), SECTIONS, META)
    expect(hasParaFormatChange(out)).toBe(true)
    expect(stripParaFormatChange(out)).toBe(null)
  })
})

describe('作った変更履歴が規格を通ること', () => {
  /**
   * 手で組み立てた XML なので、**規格に当てるまで正しいと言えない。**
   * CT_RPrChange / CT_PPrChange は子を必須とし、CT_PPrBase は
   * w:rPr / w:sectPr を許さない。どれを外しても Word は修復を出す。
   */
  const ready = schemaAvailable() && xmllintAvailable()
  const maybe = ready ? it : it.skip

  maybe('文字と段落の書式変更を入れた文書が XSD を通る', async () => {
    const loaded = readDocx(readFixture('01-plain.docx'))
    const first = loaded.doc.content[0]
    expect(first?.type).toBe('paragraph')
    const para = first as Extract<typeof first, { type: 'paragraph' }>

    const previousMarks: Mark[] = [bold, sized(24)]
    const changed = {
      ...para,
      attrs: {
        ...para.attrs,
        jc: 'right' as const,
        rawPPr: withParaFormatChange(
          para.attrs.rawPPr,
          { ...para.attrs, jc: 'center' },
          new Map(loaded.resources.sections.map((s) => [s.id, s])),
          META
        )
      },
      content: [
        {
          type: 'text' as const,
          text: '書式を変えた文字',
          marks: [
            {
              type: 'textStyle' as const,
              attrs: {
                ...DEFAULT_RUN_PROPS,
                sz: 32,
                rawRPr: withRunFormatChange(null, previousMarks, META)
              }
            }
          ]
        }
      ]
    }

    const bytes = writeDocx(
      { ...loaded, doc: { type: 'doc', content: [changed] } },
      loaded.pkg,
      {}
    )
    const problems = await validateDocx(bytes, 'format-change.docx')
    expect(problems, problems.join('\n')).toEqual([])
  })
})
