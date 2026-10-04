import { describe, it, expect } from 'vitest'
import {
  formatZip,
  expandPersonRole,
  expandCorpRole,
  expandCorpName,
  expandTitle,
  formatBirth,
  buildPersonParty,
  buildCorpParty,
  NAME_COLUMN,
  type PartyLine
} from '@core/okaguchi/party'
import { sjisWidth } from '@core/okaguchi/wideChar'

/** その行で氏名 (最後の割り付け) が始まる位置 (字) */
function nameColumn(line: PartyLine): number {
  let col = line.indent
  for (const run of line.runs.slice(0, -1)) col += run.fit ?? sjisWidth(run.text) / 2
  return col
}

describe('郵便番号', () => {
  it.each([
    ['1050001', '〒１０５－０００１'],
    ['〒1050001', '〒１０５－０００１'],
    ['105-0001', '〒１０５－０００１'],
    ['〒105-0001', '〒１０５－０００１'],
    ['１０５－０００１', '〒１０５－０００１'],
    ['', '']
  ])('%s → %s', (input, out) => expect(formatZip(input)).toBe(out))
})

describe('地位の略語', () => {
  it.each([
    ['g', '原告'],
    ['gsb', '原告訴訟代理人弁護士'],
    ['あdb', '相手方代理人弁護士'],
    ['hkh', '被控訴人兼附帯控訴人'],
    ['khg', '甲事件被告(乙事件原告)'],
    ['h1', '被告1'],
    ['d', '同'],
    ['同s', '同訴訟代理人弁護士'],
    ['2s', '上記両名訴訟代理人弁護士'],
    ['6s', '上記６名訴訟代理人弁護士'],
    ['3sf', '上記３名訴訟復代理人弁護士'],
    ['j', '事件本人'],
    ['jsb', '上告人訴訟代理人弁護士'],
    ['ｇｓｂ', '原告訴訟代理人弁護士']
  ])('%s → %s', (input, out) => expect(expandPersonRole(input)).toBe(out))

  it('法人の地位は全体一致だけ', () => {
    expect(expandCorpRole('h')).toBe('被告')
    expect(expandCorpRole('gsb')).toBe('gsb')
  })

  it('法人名と肩書', () => {
    expect(expandCorpName('ザイフリート@k')).toBe('ザイフリート株式会社')
    expect(expandCorpName('@んpおかぐち会')).toBe('特定非営利活動法人おかぐち会')
    expect(expandCorpName('@is日本法曹会')).toBe('一般社団法人日本法曹会')
    expect(expandCorpName('甲野商店')).toBe('甲野商店')
    expect(expandTitle('dt')).toBe('代表取締役')
    expect(expandTitle('代表清算人')).toBe('代表清算人')
  })
})

describe('生年月日', () => {
  it.each([
    ['s60/5/24', '昭和６０年５月２４日生'],
    ['h1/7/6', '平成元年７月６日生'],
    ['S60/5/24', '昭和６０年５月２４日生'],
    ['1985/5/24', '昭和６０年５月２４日生'],
    ['不詳', '不詳生']
  ])('%s → %s', (input, out) => expect(formatBirth(input)).toBe(out))
})

describe('自然人の当事者欄 (仕様書 4.3.7 の例)', () => {
  const lines = buildPersonParty({
    role: 'g',
    name: '甲野太郎',
    zip: '1050001',
    address1: '東京都港区虎ノ門1-1-1',
    address2: '',
    domicile: '',
    alias: '',
    birth: 's60/5/24'
  })

  it('住所の行・地位と氏名の行・生年月日の行', () => {
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({
      indent: 1,
      runs: [{ text: '〒１０５－０００１　' }, { text: '東京都港区虎ノ門１－１－１' }]
    })
    expect(lines[1]).toEqual({
      indent: 10,
      runs: [{ text: '原告', fit: 10 }, { text: '　　　' }, { text: '甲野太郎', fit: 13 }]
    })
    expect(lines[2]).toEqual({ indent: NAME_COLUMN, runs: [{ text: '昭和６０年５月２４日生', fit: 13 }] })
  })

  it('氏名はどの地位でも 23 字目から', () => {
    for (const role of ['g', 'd', 'gsb', '2s', 'khg']) {
      const [line] = buildPersonParty({
        role,
        name: '甲野太郎',
        zip: '',
        address1: '',
        address2: '',
        domicile: '',
        alias: '',
        birth: ''
      })
      expect(nameColumn(line!), role).toBe(NAME_COLUMN)
    }
  })

  it('本籍が「同」なら住所は「本籍に同じ」。都道府県を含む短い本籍は国籍にしない', () => {
    const same = buildPersonParty({
      role: '',
      name: '乙山花子',
      zip: '',
      address1: '東京都港区',
      address2: '',
      domicile: '同',
      alias: '',
      birth: ''
    })
    expect(same[0]?.runs[0]?.text).toBe('本籍　東京都港区')
    expect(same[1]?.runs.map((r) => r.text).join('')).toBe('住所　本籍に同じ')
    const nationality = buildPersonParty({
      role: '',
      name: 'X',
      zip: '',
      address1: '',
      address2: '',
      domicile: '中国',
      alias: '',
      birth: ''
    })
    expect(nationality[0]?.runs[0]?.text).toBe('国籍　中国')
  })

  it('通称は「こと」を付けて氏名の上の行', () => {
    const lines2 = buildPersonParty({
      role: 'h',
      name: '甲野太郎',
      zip: '',
      address1: '',
      address2: '',
      domicile: '',
      alias: '甲太',
      birth: ''
    })
    expect(lines2[0]?.runs.at(-1)).toEqual({ text: '甲太こと', fit: 13 })
    expect(lines2[1]).toEqual({ indent: NAME_COLUMN, runs: [{ text: '甲野太郎', fit: 13 }] })
  })

  it('住所の 2 段目は郵便番号の後ろにそろえる', () => {
    const lines2 = buildPersonParty({
      role: '',
      name: '',
      zip: '1050001',
      address1: '東京都港区虎ノ門一丁目',
      address2: '1番1号 虎ノ門ビル',
      domicile: '',
      alias: '',
      birth: ''
    })
    expect(lines2[1]?.indent).toBe(11)
  })
})

describe('法人の当事者欄 (仕様書 5.3.6 の例)', () => {
  it('住所・地位と法人名・代表者', () => {
    const lines = buildCorpParty({
      role: 'h',
      corpName: 'ザイフリート@k',
      title: 'dt',
      representative: '甲野太郎',
      zip: '1000013',
      address1: '東京都千代田区霞が関1-1-4',
      address2: ''
    })
    expect(lines).toHaveLength(3)
    expect(lines[0]?.runs.map((r) => r.text).join('')).toBe('〒１００－００１３　東京都千代田区霞が関１－１－４')
    expect(lines[1]).toEqual({
      indent: 10,
      runs: [{ text: '被告', fit: 10 }, { text: '　　　' }, { text: 'ザイフリート株式会社', fit: 13 }]
    })
    expect(lines[2]).toEqual({
      indent: 10,
      runs: [{ text: '上記代表者代表取締役', fit: 10 }, { text: '　　　' }, { text: '甲野太郎', fit: 13 }]
    })
  })
})
