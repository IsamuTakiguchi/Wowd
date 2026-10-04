import { describe, it, expect } from 'vitest'
import {
  buildLand,
  buildBuilding,
  buildCondo,
  buildPropertyList,
  type BuildingInput,
  type CondoInput,
  type FloorArea
} from '@core/okaguchi/property'
import type { PartyLine } from '@core/okaguchi/party'

const S = '　'
const text = (line: PartyLine | undefined): string => (line?.runs ?? []).map((r) => r.text).join('')
const floors = (...pairs: [string, string][]): FloorArea[] => {
  const out = pairs.map(([floor, area]) => ({ floor, area }))
  while (out.length < 6) out.push({ floor: '', area: '' })
  return out
}

const building = (partial: Partial<BuildingInput>): BuildingInput => ({
  title: '',
  location: '',
  houseNumber: '',
  kind: '',
  structure: '',
  floors: floors(),
  share: '',
  annex: { sign: '', kind: '', structure: '', area1: '', area2: '' },
  ...partial
})

const condo = (partial: Partial<CondoInput>): CondoInput => ({
  title: '',
  location: '',
  buildingName: '',
  structure: '',
  floors: floors(),
  houseNumber: '',
  unitName: '',
  unitKind: '',
  unitStructure: '',
  unitFloors: [
    { floor: '', area: '' },
    { floor: '', area: '' }
  ],
  share: '',
  siteSign: '',
  siteLocation: '',
  siteCategory: '',
  siteArea: '',
  siteKind: '',
  siteRatio: '',
  ...partial
})

describe('土地', () => {
  it('見出しは 4 字幅の均等割り付け、値は全角、空の欄は出さない', () => {
    const lines = buildLand({ title: '1', location: '東京都港区虎ノ門一丁目', lotNumber: '1番1', category: '宅地', area: '123.45', share: '' })
    expect(lines).toHaveLength(5)
    expect(lines[0]).toEqual({ indent: 0, runs: [{ text: '1' }] })
    expect(lines[2]).toEqual({ indent: 0, runs: [{ text: '地番', fit: 4 }, { text: `${S}${S}１番１` }] })
    expect(text(lines[4])).toBe(`地積${S}${S}１２３．４５㎡`)
  })
})

describe('建物の床面積', () => {
  it('仕様書の例: 面積の右端をそろえる', () => {
    const lines = buildBuilding(building({ floors: floors(['1', '50.00'], ['2', '45.5']) }), { annexOnly: false })
    expect(text(lines[0])).toBe(`床面積${S}${S}１階${S}５０．００㎡`)
    expect(text(lines[1])).toBe(`${S.repeat(6)}２階${S}${S}４５．５㎡`)
  })

  it('5・6 行目もそれぞれの面積を出す (元のマクロは 4 行目の面積を出していた)', () => {
    const lines = buildBuilding(
      building({ floors: floors(['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']) }),
      { annexOnly: false }
    )
    expect(text(lines[4])).toContain('５階')
    expect(text(lines[4])).toContain('５㎡')
    expect(text(lines[5])).toContain('６㎡')
  })

  it('1 行だけなら階を書かない', () => {
    const lines = buildBuilding(building({ floors: floors(['', '80.1']) }), { annexOnly: false })
    expect(text(lines[0])).toBe(`床面積${S}${S}８０．１㎡`)
  })

  it('附属建物は見出しの下にまとめ、1 階だけでも全角にする', () => {
    const lines = buildBuilding(
      building({ location: '港区', annex: { sign: '1', kind: '物置', structure: '', area1: '5.0', area2: '' } }),
      { annexOnly: false }
    )
    expect(lines.map(text)).toEqual([
      `所在${S}${S}港区`,
      '（附属建物）',
      `符号${S}${S}１`,
      `種類${S}${S}物置`,
      `床面積${S}${S}５．０㎡`
    ])
  })

  it('附属建物の記載のみ', () => {
    const lines = buildBuilding(
      building({ location: '港区', annex: { sign: '1', kind: '', structure: '', area1: '', area2: '' } }),
      { annexOnly: true }
    )
    expect(lines.map(text)).toEqual([`符号${S}${S}１`])
  })
})

describe('区分建物', () => {
  it('一棟・専有部分・敷地権。見出しは 6 字幅、地積に㎡を付ける', () => {
    const lines = buildCondo(
      condo({
        location: '港区虎ノ門一丁目1番地1',
        buildingName: '虎ノ門ハイツ',
        houseNumber: '虎ノ門一丁目1番1の101',
        unitFloors: [
          { floor: '1', area: '50.00' },
          { floor: '', area: '' }
        ],
        siteSign: '1',
        siteArea: '500.00',
        siteRatio: '1000分の50'
      }),
      { siteOnly: false }
    )
    expect(lines.map(text)).toEqual([
      '（一棟の建物の表示）',
      `所在${S}${S}港区虎ノ門一丁目１番地１`,
      `建物の名称${S}${S}虎ノ門ハイツ`,
      '（専有部分の建物の表示）',
      `家屋番号${S}${S}虎ノ門一丁目１番１の１０１`,
      `床面積${S}${S}１階部分${S}５０．００㎡`,
      '（敷地権の表示）',
      `土地の符号${S}${S}１`,
      `地積${S}${S}５００．００㎡`,
      `敷地権の割合${S}${S}１０００分の５０`
    ])
    expect(lines[1]?.runs[0]).toEqual({ text: '所在', fit: 6 })
  })

  it('一棟の建物の階は、番号が空なら 1 階から数える', () => {
    const lines = buildCondo(condo({ floors: floors(['', '100'], ['', '90']) }), { siteOnly: false })
    expect(text(lines[0])).toBe(`床面積${S}${S}１階${S}１００㎡`)
    expect(text(lines[1])).toBe(`${S.repeat(8)}２階${S}${S}９０㎡`)
  })
})

describe('物件目録の全体', () => {
  it('冒頭に（別紙）物件目録 (中央揃え)、物件の間は 1 行空ける', () => {
    const lines = buildPropertyList(
      { title: '', location: '港区', lotNumber: '', category: '', area: '', share: '' },
      building({ location: '港区' }),
      condo({}),
      { header: true, annexOnly: false, siteOnly: false }
    )
    expect(lines[0]).toEqual({ indent: 0, runs: [{ text: '（別紙）' }] })
    expect(lines[1]).toEqual({ indent: 0, runs: [{ text: '物件目録' }], align: 'center' })
    expect(lines[3]?.runs).toEqual([])
  })
})
