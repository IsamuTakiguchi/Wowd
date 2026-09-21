import { describe, expect, it } from 'vitest'
import {
  rulerTicks,
  indentMarkers,
  indentFromPosition,
  snapToRuler,
  formatMm
} from '@core/layout/ruler'
import { pageGeometry } from '@core/layout/pageGeometry'
import { defaultSection } from '@core/docx/read/section'
import { mmToTwip, twipToMm } from '@shared/units'

/** A4 縦、余白 1 インチ (25.4mm) の既定セクションから作る */
function a4Ruler() {
  const g = pageGeometry(defaultSection('s1'))
  return {
    length: g.pageInline,
    textStart: g.marginStart,
    textEnd: g.marginStart + g.textInline
  }
}

describe('rulerTicks', () => {
  it('目盛りの原点は本文領域の左端 (紙の端ではない)', () => {
    const area = a4Ruler()
    const model = rulerTicks(area)
    const zero = model.ticks.find((t) => t.at === area.textStart)
    expect(zero?.label).toBe(0)
  })

  it('数字は 10mm ごと、細かい目盛りは 5mm ごと', () => {
    const model = rulerTicks(a4Ruler())
    const majors = model.ticks.filter((t) => t.major)
    const gaps = majors.slice(1).map((t, i) => t.at - (majors[i] as { at: number }).at)
    for (const gap of gaps) expect(twipToMm(gap)).toBeCloseTo(10, 1)

    const all = model.ticks.map((t) => t.at).sort((a, b) => a - b)
    const minorGaps = all.slice(1).map((v, i) => v - (all[i] as number))
    for (const gap of minorGaps) expect(twipToMm(gap)).toBeCloseTo(5, 1)
  })

  it('余白の中では数字が戻る (符号は付けない)', () => {
    const area = a4Ruler()
    const model = rulerTicks(area)
    const leftOfOrigin = model.ticks.filter((t) => t.at < area.textStart && t.major)
    expect(leftOfOrigin.length).toBeGreaterThan(0)
    for (const t of leftOfOrigin) expect(t.label).toBeGreaterThan(0)
    // 原点から 10mm 左の目盛りは 10 と出る
    const ten = model.ticks.find((t) => Math.abs(t.at - (area.textStart - mmToTwip(10))) < 2)
    expect(ten?.label).toBe(10)
  })

  it('用紙からはみ出す目盛りは作らない', () => {
    const area = a4Ruler()
    const model = rulerTicks(area)
    for (const t of model.ticks) {
      expect(t.at).toBeGreaterThanOrEqual(0)
      expect(t.at).toBeLessThanOrEqual(area.length)
    }
  })

  it('刻みを変えられる', () => {
    const model = rulerTicks({ ...a4Ruler(), majorMm: 20, minorMm: 10 })
    const majors = model.ticks.filter((t) => t.major)
    expect(twipToMm((majors[1] as { at: number }).at - (majors[0] as { at: number }).at)).toBeCloseTo(20, 1)
  })
})

describe('indentMarkers', () => {
  const area = { textStart: mmToTwip(25.4), textEnd: mmToTwip(25.4 + 160) }
  const em = mmToTwip(3.7) // 10.5pt の全角 1 文字ぶん

  it('字下げが無ければ三角は本文領域の両端に来る', () => {
    const m = indentMarkers(null, area, em)
    expect(m.left).toBe(area.textStart)
    expect(m.firstLine).toBe(area.textStart)
    expect(m.right).toBe(area.textEnd)
  })

  it('左の字下げは 2 行目以降と 1 行目の両方を動かす', () => {
    const m = indentMarkers({ left: mmToTwip(10) }, area, em)
    expect(twipToMm(m.left - area.textStart)).toBeCloseTo(10, 1)
    expect(m.firstLine).toBe(m.left)
  })

  it('1 行目の字下げは 1 行目だけを右へ動かす', () => {
    const m = indentMarkers({ left: mmToTwip(10), firstLine: mmToTwip(5) }, area, em)
    expect(twipToMm(m.firstLine - m.left)).toBeCloseTo(5, 1)
  })

  it('ぶら下げは 1 行目だけを左へ動かす', () => {
    const m = indentMarkers({ left: mmToTwip(10), hanging: mmToTwip(5) }, area, em)
    expect(twipToMm(m.left - m.firstLine)).toBeCloseTo(5, 1)
  })

  it('右の字下げは右端から内側へ', () => {
    const m = indentMarkers({ right: mmToTwip(20) }, area, em)
    expect(twipToMm(area.textEnd - m.right)).toBeCloseTo(20, 1)
  })

  /** 日本語 Word は字下げを文字単位で書く。そちらがある文書では twip より優先される */
  it('文字単位の指定があればそちらを使う', () => {
    const m = indentMarkers({ left: mmToTwip(99), leftChars: 200 }, area, em)
    // 2 文字ぶん = em * 2
    expect(m.left - area.textStart).toBe(em * 2)
  })
})

describe('indentFromPosition', () => {
  const area = { textStart: mmToTwip(25.4), textEnd: mmToTwip(25.4 + 160) }
  const current = { left: area.textStart, firstLine: area.textStart, right: area.textEnd }

  it('つかんだ位置がそのまま字下げになる', () => {
    const at = area.textStart + mmToTwip(20)
    expect(twipToMm(indentFromPosition('left', at, area, current))).toBeCloseTo(20, 1)
  })

  it('右の三角は右端からの距離として返る', () => {
    const at = area.textEnd - mmToTwip(30)
    expect(twipToMm(indentFromPosition('right', at, area, current))).toBeCloseTo(30, 1)
  })

  it('右の三角は左の書き出しより左へは行けない', () => {
    const withLeft = { ...current, left: area.textStart + mmToTwip(50) }
    const at = area.textStart // ずっと左まで引っぱった
    const right = indentFromPosition('right', at, area, withLeft)
    // 左の書き出しの位置で止まる
    expect(area.textEnd - right).toBe(withLeft.left)
  })

  it('本文領域より右には出さない', () => {
    const at = area.textEnd + mmToTwip(100)
    const left = indentFromPosition('left', at, area, current)
    expect(area.textStart + left).toBeLessThanOrEqual(area.textEnd)
  })
})

describe('snapToRuler', () => {
  it('0.5mm 刻みに吸い付く', () => {
    const near = mmToTwip(10) + 3
    expect(twipToMm(snapToRuler(near))).toBeCloseTo(10, 1)
  })

  it('刻みを変えられる', () => {
    const snapped = snapToRuler(mmToTwip(12.4), 5)
    expect(twipToMm(snapped)).toBeCloseTo(10, 1)
  })
})

describe('formatMm', () => {
  it('小数 1 桁の mm で出す', () => {
    expect(formatMm(mmToTwip(12.34))).toBe('12.3mm')
    expect(formatMm(0)).toBe('0mm')
  })
})
