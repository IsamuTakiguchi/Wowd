import { describe, it, expect } from 'vitest'
import { formatNumber, renderLevelText } from '@core/numbering/format'
import { ensureListDefinition } from '@core/numbering/create'
import { resolveLevel, emptyNumberingTable, nextNumId } from '@core/numbering/resolve'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { writeNumbering } from '@core/docx/write/numbering'
import { readNumbering } from '@core/docx/read/numbering'
import { readFixture } from './helpers'

describe('formatNumber', () => {
  it('アラビア数字', () => {
    expect(formatNumber(1, 'decimal')).toBe('1')
    expect(formatNumber(42, 'decimal')).toBe('42')
    expect(formatNumber(7, 'decimalZero')).toBe('07')
  })

  it('全角数字', () => {
    expect(formatNumber(12, 'decimalFullWidth')).toBe('１２')
  })

  it('英字', () => {
    expect(formatNumber(1, 'lowerLetter')).toBe('a')
    expect(formatNumber(26, 'lowerLetter')).toBe('z')
    expect(formatNumber(27, 'lowerLetter')).toBe('aa')
    expect(formatNumber(3, 'upperLetter')).toBe('C')
  })

  it('ローマ数字', () => {
    expect(formatNumber(4, 'lowerRoman')).toBe('iv')
    expect(formatNumber(1990, 'upperRoman')).toBe('MCMXC')
  })

  it('丸数字', () => {
    expect(formatNumber(1, 'decimalEnclosedCircle')).toBe('①')
    expect(formatNumber(20, 'decimalEnclosedCircle')).toBe('⑳')
    // 範囲外は素直に数字へ落とす
    expect(formatNumber(21, 'decimalEnclosedCircle')).toBe('21')
  })

  it('あいうえお / イロハ', () => {
    expect(formatNumber(1, 'aiueo')).toBe('あ')
    expect(formatNumber(3, 'aiueoFullWidth')).toBe('ウ')
    expect(formatNumber(1, 'iroha')).toBe('い')
    expect(formatNumber(2, 'irohaFullWidth')).toBe('ロ')
    // かなは 46 字で一巡し、そのあとは重ねる
    expect(formatNumber(46, 'aiueo')).toBe('ん')
    expect(formatNumber(47, 'aiueo')).toBe('ああ')
  })

  it('漢数字 (各桁置換)', () => {
    expect(formatNumber(1234, 'ideographDigital')).toBe('一二三四')
    expect(formatNumber(10, 'ideographDigital')).toBe('一〇')
  })

  it('漢数字 (位取りあり)', () => {
    expect(formatNumber(1, 'japaneseCounting')).toBe('一')
    expect(formatNumber(10, 'japaneseCounting')).toBe('十')
    expect(formatNumber(11, 'japaneseCounting')).toBe('十一')
    expect(formatNumber(20, 'japaneseCounting')).toBe('二十')
    expect(formatNumber(100, 'japaneseCounting')).toBe('百')
    expect(formatNumber(1234, 'japaneseCounting')).toBe('千二百三十四')
    expect(formatNumber(10000, 'japaneseCounting')).toBe('一万')
    expect(formatNumber(10001, 'japaneseCounting')).toBe('一万一')
  })

  it('大字 (契約書で使う)', () => {
    expect(formatNumber(1, 'japaneseLegal')).toBe('壱')
    expect(formatNumber(23, 'japaneseLegal')).toBe('弐拾参')
  })

  it('bullet と none は序数を出さない', () => {
    expect(formatNumber(5, 'bullet')).toBe('')
    expect(formatNumber(5, 'none')).toBe('')
  })

  it('未知の書式は decimal に落とす (番号が消えるよりよい)', () => {
    expect(formatNumber(9, 'someUnknownFormat')).toBe('9')
  })
})

describe('renderLevelText', () => {
  it('単一レベル', () => {
    expect(renderLevelText('%1.', [3], ['decimal'])).toBe('3.')
  })

  it('複数レベルを各レベルの書式で整形する', () => {
    expect(renderLevelText('%1.%2', [2, 3], ['decimal', 'decimal'])).toBe('2.3')
    expect(renderLevelText('第%1章', [5], ['japaneseCounting'])).toBe('第五章')
  })

  it('値の無いレベルは空にする', () => {
    expect(renderLevelText('%1.%2', [1], ['decimal', 'decimal'])).toBe('1.')
  })

  it('記号を含むテンプレート', () => {
    expect(renderLevelText('(%1)', [7], ['decimal'])).toBe('(7)')
  })
})

describe('ensureListDefinition', () => {
  it('定義が無ければ作る', () => {
    const table = emptyNumberingTable()
    const { numId, created } = ensureListDefinition(table, 'bullet')
    expect(created).toBe(true)
    expect(table.instances.has(numId)).toBe(true)

    const level = resolveLevel(table, numId, 0)
    expect(level?.numFmt).toBe('bullet')
    expect(level?.lvlText).toBe('●')
  })

  it('同じ種類が既にあれば再利用する', () => {
    const table = emptyNumberingTable()
    const first = ensureListDefinition(table, 'decimal')
    const second = ensureListDefinition(table, 'decimal')
    expect(second.created).toBe(false)
    expect(second.numId).toBe(first.numId)
  })

  it('箇条書きと段落番号は別の定義になる', () => {
    const table = emptyNumberingTable()
    const bullet = ensureListDefinition(table, 'bullet')
    const decimal = ensureListDefinition(table, 'decimal')
    expect(bullet.numId).not.toBe(decimal.numId)
    expect(resolveLevel(table, decimal.numId, 0)?.numFmt).toBe('decimal')
  })

  it('9 レベルすべてに定義が入る', () => {
    const table = emptyNumberingTable()
    const { numId } = ensureListDefinition(table, 'decimal')
    for (let ilvl = 0; ilvl < 9; ilvl++) {
      expect(resolveLevel(table, numId, ilvl), `ilvl=${ilvl}`).not.toBeNull()
    }
  })

  it('レベルが深くなるほどインデントが増える', () => {
    const table = emptyNumberingTable()
    const { numId } = ensureListDefinition(table, 'bullet')
    const l0 = resolveLevel(table, numId, 0)?.pPr?.ind?.left ?? 0
    const l1 = resolveLevel(table, numId, 1)?.pPr?.ind?.left ?? 0
    expect(l1).toBeGreaterThan(l0)
  })
})

describe('numbering.xml の読み書き', () => {
  it('実ファイルの定義を読み、レベルを解決できる', () => {
    const { resources } = readDocx(readFixture('04-lists.docx'))
    const { numbering } = resources
    expect(numbering.instances.size).toBeGreaterThan(0)

    const numId = [...numbering.instances.keys()][0]!
    const level = resolveLevel(numbering, numId, 0)
    expect(level).not.toBeNull()
    expect(level!.lvlText.length).toBeGreaterThan(0)
  })

  it('新しく作った定義を書き出して読み直せる', () => {
    const table = emptyNumberingTable()
    const { numId } = ensureListDefinition(table, 'decimal')

    const xml = writeNumbering(table)
    expect(xml).toContain('<w:numbering')
    expect(xml).toContain('w:abstractNumId')

    const reparsed = readNumbering(xml)
    const level = resolveLevel(reparsed, numId, 0)
    expect(level?.numFmt).toBe('decimal')
    expect(level?.lvlText).toBe('%1.')
    expect(level?.pPr?.ind?.hanging).toBe(360)
  })

  it('既存の定義は原文のまま書き戻される', () => {
    const doc = readDocx(readFixture('04-lists.docx'))
    const saved = writeDocx(doc, doc.pkg, { numberingChanged: true })
    const reparsed = readDocx(saved)

    expect(reparsed.resources.numbering.instances.size).toBe(
      doc.resources.numbering.instances.size
    )
    for (const numId of doc.resources.numbering.instances.keys()) {
      const before = resolveLevel(doc.resources.numbering, numId, 0)
      const after = resolveLevel(reparsed.resources.numbering, numId, 0)
      expect(after?.numFmt, `numId=${numId}`).toBe(before?.numFmt)
      expect(after?.lvlText, `numId=${numId}`).toBe(before?.lvlText)
    }
  })

  it('nextNumId が既存と衝突しない', () => {
    const table = emptyNumberingTable()
    ensureListDefinition(table, 'bullet')
    ensureListDefinition(table, 'decimal')
    expect(table.instances.has(nextNumId(table))).toBe(false)
  })
})
