import { describe, it, expect } from 'vitest'
import {
  parseDateInput,
  formatDateEntry,
  warekiYear,
  holidayName,
  weekday,
  toWideAscii
} from '@core/okaguchi/dates'
import { wideOneChar, toNarrowWithKana, sjisWidth } from '@core/okaguchi/wideChar'
import { courtStyles, courtSection } from '@core/okaguchi/pageFormat'
import { gridFromSection } from '@core/layout/grid'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { estimateTextEm, scaleMarginEm } from '@core/css/runCss'
import { readFixture } from './helpers'

const TODAY = { y: 2026, m: 10, d: 4 }

describe('日付の入力 (元のマクロと同じ書き方を受け付ける)', () => {
  it.each([
    ['', 2026, 10, 4],
    ['1/1', 2026, 1, 1],
    ['11/11', 2026, 11, 11],
    ['h1/1/8', 1989, 1, 8],
    ['r1/5/15', 2019, 5, 15],
    ['s60/5/24', 1985, 5, 24],
    ['2004/12/15', 2004, 12, 15],
    ['ｒ２／５／３', 2020, 5, 3],
    ['Ｒ2/5/3', 2020, 5, 3],
    ['2024.2.29', 2024, 2, 29]
  ])('%s → %i/%i/%i', (input, y, m, d) => {
    expect(parseDateInput(input, TODAY)).toMatchObject({ y, m, d })
  })

  it('日付でないものは読まない', () => {
    expect(parseDateInput('2023/2/29', TODAY)).toBeNull()
    expect(parseDateInput('13/1', TODAY)).toBeNull()
    expect(parseDateInput('abc', TODAY)).toBeNull()
  })

  it('月・日は入力どおり (前ゼロも残す)', () => {
    expect(parseDateInput('2020/01/05', TODAY)).toMatchObject({ monthText: '01', dayText: '05' })
  })
})

describe('和暦', () => {
  it('元号は日付で決まり、1 年は元年', () => {
    expect(warekiYear({ y: 2019, m: 4, d: 30 })).toBe('平成31年')
    expect(warekiYear({ y: 2019, m: 5, d: 1 })).toBe('令和元年')
    expect(warekiYear({ y: 1989, m: 1, d: 7 })).toBe('昭和64年')
    expect(warekiYear({ y: 1989, m: 1, d: 8 })).toBe('平成元年')
    expect(warekiYear({ y: 2026, m: 10, d: 4 })).toBe('令和8年')
  })
})

describe('休日 (祝日法どおり。元の表の誤りを直したもの)', () => {
  it.each([
    [2020, 7, 23, '休日(海の日)'],
    [2020, 7, 24, '休日(スポーツの日)'],
    [2020, 8, 10, '休日(山の日)'],
    [2021, 8, 9, '休日(山の日の振替)'],
    [1980, 10, 10, '休日(体育の日)'],
    [2025, 5, 6, '休日(みどりの日の振替)'],
    [2026, 9, 22, '休日(国民の休日)'],
    [2019, 4, 30, '休日(国民の休日)'],
    [2019, 5, 1, '休日(天皇の即位の日)'],
    [2024, 9, 23, '休日(秋分の日の振替)']
  ])('%i/%i/%i は %s', (y, m, d, name) => {
    expect(holidayName({ y, m, d })).toBe(name)
  })

  it.each([
    [2020, 7, 20],
    [2020, 8, 11],
    [2021, 7, 19],
    [2021, 10, 11],
    [2026, 10, 5]
  ])('%i/%i/%i は休日でない (元の表は休日にしていた日)', (y, m, d) => {
    expect(holidayName({ y, m, d })).toBeNull()
  })

  it('曜日', () => {
    expect(weekday({ y: 2026, m: 10, d: 4 })).toBe(0)
    expect(weekday({ y: 2020, m: 5, d: 3 })).toBe(0)
  })
})

describe('日付入力の出力', () => {
  const date = parseDateInput('r2/5/3', TODAY)!

  it('仕様書の例: 和暦・全角・曜日有・休日有', () => {
    expect(
      formatDateEntry(date, { style: 'wareki', wide: true, weekday: true, holiday: true })
    ).toBe('令和２年５月３日（日曜日・休日（憲法記念日））')
  })

  it('表記の 4 通り (半角)', () => {
    const f = (style: Parameters<typeof formatDateEntry>[1]['style']) =>
      formatDateEntry(date, { style, wide: false, weekday: false, holiday: false })
    expect(f('western')).toBe('2020年5月3日')
    expect(f('wareki')).toBe('令和2年5月3日')
    expect(f('westernWareki')).toBe('2020年(令和2年)5月3日')
    expect(f('warekiWestern')).toBe('令和2年(2020年)5月3日')
  })

  it('平日は「平日」、半角でもカナは半角にしない', () => {
    const weekdayDate = parseDateInput('2020/7/24', TODAY)!
    expect(
      formatDateEntry(weekdayDate, { style: 'western', wide: false, weekday: false, holiday: true })
    ).toBe('2020年7月24日(休日(スポーツの日))')
    const plain = parseDateInput('2026/10/6', TODAY)!
    expect(formatDateEntry(plain, { style: 'western', wide: false, weekday: true, holiday: true })).toBe(
      '2026年10月6日(火曜日・平日)'
    )
  })

  it('全角化は英数字と記号だけ', () => {
    expect(toWideAscii('A1 (x)')).toBe('Ａ１　（ｘ）')
  })
})

describe('全角1文字入力', () => {
  it('括弧を 50%、中の文字はそのまま、後ろに全角スペース', () => {
    expect(wideOneChar('1', { fit: false, noSpace: false })).toEqual([
      { text: '(', w: 50 },
      { text: '1', w: 100 },
      { text: ')', w: 50 },
      { text: '　', w: 100 }
    ])
  })

  it('全角カナは半角カナにする (ア → ｱ)', () => {
    expect(wideOneChar('ア', { fit: false, noSpace: true })[1]).toEqual({ text: 'ｱ', w: 100 })
    expect(toNarrowWithKana('ガ１')).toBe('ｶﾞ1')
    expect(sjisWidth('ｶﾞ1')).toBe(3)
  })

  it('収める指定のとき、2 字以上は 100 / バイト数 %', () => {
    expect(wideOneChar('10', { fit: true, noSpace: true })[1]).toEqual({ text: '10', w: 50 })
    expect(wideOneChar('10', { fit: false, noSpace: true })[1]).toEqual({ text: '10', w: 100 })
  })

  it('縮めた幅だけ後ろを詰める (括弧 2 つで半角 1 字分)', () => {
    expect(estimateTextEm('(')).toBe(0.5)
    expect(estimateTextEm('ア')).toBe(1)
    expect(scaleMarginEm('(', 50)).toBe(-0.25)
    expect(scaleMarginEm('(', 100)).toBeNull()
  })
})

describe('書式変更 (裁判所書式)', () => {
  it('A4・余白・37 字 × 26 行・行番号', () => {
    const doc = readDocx(readFixture('01-plain.docx'))
    const section = courtSection(doc.resources.sections[0]!, true)
    expect(section.pgSz).toMatchObject({ w: 11906, h: 16838 })
    expect(section.pgMar).toMatchObject({ top: 1984, bottom: 1417, left: 1701, right: 1134, footer: 850, header: 0 })
    const grid = gridFromSection(section, 24)
    expect(grid?.charsPerLine).toBe(37)
    expect(grid?.linesPerPage).toBe(26)
    expect(section.rawSectPr).toContain('<w:lnNumType w:countBy="5" w:restart="newPage"/>')
    // 行番号を外すと消える
    expect(courtSection(section, false).rawSectPr ?? '').not.toContain('lnNumType')
  })

  it('標準スタイルは ＭＳ 明朝 + 選んだ英字フォント、12pt。保存して開き直せる', () => {
    const doc = readDocx(readFixture('01-plain.docx'))
    const styles = courtStyles(doc.resources.styles, 'Century')
    const normalId = styles.defaults.paragraph ?? 'Normal'
    expect(styles.byId.get(normalId)?.rPr).toMatchObject({
      sz: 24,
      kern: 2,
      rFonts: { eastAsia: 'ＭＳ 明朝', ascii: 'Century', hAnsi: 'Century' }
    })
    const section = courtSection(doc.resources.sections[0]!, true)
    const saved = writeDocx(
      { ...doc, resources: { ...doc.resources, styles, sections: [section] } },
      doc.pkg,
      { stylesChanged: true }
    )
    const reread = readDocx(saved)
    expect(reread.resources.styles.byId.get(normalId)?.rPr?.sz).toBe(24)
    expect(gridFromSection(reread.resources.sections[0]!, 24)?.charsPerLine).toBe(37)
  })
})
