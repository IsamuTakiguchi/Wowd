import { describe, it, expect } from 'vitest'
import {
  setupRanks,
  findRankStyleIds,
  rankBaseNumId,
  createRestartNum,
  planHalfWidthFix,
  rankStyleName,
  bodyStyleName,
  type RankParagraph
} from '@core/okaguchi/rank'
import { computeListMarkers } from '@core/numbering/markers'
import { ensureListDefinition } from '@core/numbering/create'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { readFixture } from './helpers'

function setup() {
  const doc = readDocx(readFixture('01-plain.docx'))
  const { styles, numbering, sections } = doc.resources
  const result = setupRanks(styles, numbering, sections[0])
  return { doc, ...result, numbering }
}

describe('連番ランク設定 (Alt+R)', () => {
  it('本文０〜８とランク１〜８を全角数字の名前で作る', () => {
    const { styles, ids } = setup()
    expect(rankStyleName(1)).toBe('ランク１')
    expect(bodyStyleName(0)).toBe('本文０')
    expect(findRankStyleIds(styles)).toEqual(ids)
    expect(styles.byId.get(ids.rank[1]!)?.name).toBe('ランク１')
    expect(styles.byId.get(ids.rank[1]!)?.next).toBe(ids.body[1])
    expect(styles.byId.get(ids.rank[3]!)?.pPr?.outlineLvl).toBe(2)
  })

  it('インデントは仕様どおり (本文１・２は左 2 字・字下げ 1 字、ランクN は左 max(N,2) 字)', () => {
    const { styles, ids } = setup()
    const ind = (id: string | undefined) => styles.byId.get(id ?? '')?.pPr?.ind
    expect(ind(ids.body[0])).toMatchObject({ leftChars: 0, firstLineChars: 0 })
    expect(ind(ids.body[1])).toMatchObject({ leftChars: 200, firstLineChars: 100 })
    expect(ind(ids.body[2])).toMatchObject({ leftChars: 200, firstLineChars: 100 })
    expect(ind(ids.body[5])).toMatchObject({ leftChars: 500, firstLineChars: 100 })
    expect(ind(ids.rank[1])).toMatchObject({ leftChars: 200, firstLineChars: 0 })
    expect(ind(ids.rank[8])).toMatchObject({ leftChars: 800, firstLineChars: 0 })
  })

  it('ランクの番号は 第１ / １ / ⑴ / ア / (ア) / a / (a) / ① で、右揃え・区切りなし', () => {
    const { styles, ids, numbering } = setup()
    const paragraphs = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ numPr: null, pStyle: ids.rank[n]! }))
    const markers = computeListMarkers(paragraphs, numbering, styles)
    expect([...markers.values()].map((m) => m.text)).toEqual([
      '第１',
      '１',
      '⑴',
      'ア',
      '(ア)',
      'a',
      '(a)',
      '①'
    ])
    for (const m of markers.values()) {
      expect(m.level.lvlJc).toBe('right')
      expect(m.suffix).toBe('')
    }
    expect(markers.get(4)?.level.rPr?.w).toBe(50)
    expect(markers.get(6)?.level.rPr?.w).toBe(66)
  })

  it('上位のランクが出ると下位の番号は 1 に戻る', () => {
    const { styles, ids, numbering } = setup()
    const r = (n: number) => ({ numPr: null, pStyle: ids.rank[n]! })
    const markers = computeListMarkers([r(1), r(2), r(2), r(1), r(2)], numbering, styles)
    expect(markers.get(2)?.text).toBe('２')
    expect(markers.get(3)?.text).toBe('第２')
    expect(markers.get(4)?.text).toBe('１')
  })

  it('何度実行しても同じスタイルと番号定義を更新するだけ', () => {
    const first = setup()
    const again = setupRanks(first.styles, first.numbering, first.doc.resources.sections[0])
    expect(again.ids).toEqual(first.ids)
    expect(again.numId).toBe(first.numId)
    expect(again.styles.byId.size).toBe(first.styles.byId.size)
  })

  it('ふつうの番号付きリストは連番ランクの定義を流用しない', () => {
    const { numbering, numId } = setup()
    const { numId: listId } = ensureListDefinition(numbering, 'decimal')
    expect(listId).not.toBe(numId)
  })

  it('保存して開き直しても、スタイルと番号が残る (Word で開ける形)', () => {
    const { doc, styles, ids } = setup()
    const saved = writeDocx({ ...doc, resources: { ...doc.resources, styles } }, doc.pkg, {
      stylesChanged: true,
      numberingChanged: true
    })
    const reread = readDocx(saved)
    const rereadIds = findRankStyleIds(reread.resources.styles)
    expect(rereadIds).toEqual(ids)
    const base = rankBaseNumId(reread.resources.styles, rereadIds!, reread.resources.numbering)
    expect(base).not.toBeNull()
    const markers = computeListMarkers(
      [{ numPr: null, pStyle: ids.rank[1]! }, { numPr: null, pStyle: ids.rank[3]! }],
      reread.resources.numbering,
      reread.resources.styles
    )
    expect(markers.get(0)?.text).toBe('第１')
    expect(markers.get(1)?.text).toBe('⑴')
  })
})

describe('打直 (Alt+Shift+N)', () => {
  it('その段落から 1 に戻り、後続はその続き。上位は続き番号のまま', () => {
    const { styles, ids, numbering, numId } = setup()
    const restart = createRestartNum(numbering, numId, 2)
    const r = (n: number, numPr: RankParagraph['numPr'] = null) => ({ numPr, pStyle: ids.rank[n]! })
    const markers = computeListMarkers(
      [r(1), r(3), r(3), r(3, { numId: restart, ilvl: 2 }), r(3), r(1)],
      numbering,
      styles
    )
    expect(markers.get(2)?.text).toBe('⑵')
    expect(markers.get(3)?.text).toBe('⑴')
    expect(markers.get(4)?.text).toBe('⑵')
    expect(markers.get(5)?.text).toBe('第２')
  })
})

describe('連番ランク修正 (Alt+Shift+R)', () => {
  function apply(paragraphs: RankParagraph[], plan: Map<number, RankParagraph['numPr']>): RankParagraph[] {
    return paragraphs.map((p, i) => (plan.has(i) ? { ...p, numPr: plan.get(i) ?? null } : p))
  }

  it('ランク１・２の 10 以上を半角にし、1〜9 は全角のまま', () => {
    const { styles, ids, numbering } = setup()
    const paragraphs: RankParagraph[] = []
    for (let i = 0; i < 11; i++) paragraphs.push({ numPr: null, pStyle: ids.rank[1]! })
    // 第11 の下にランク２を 10 個 → 10 だけ半角
    for (let i = 0; i < 10; i++) paragraphs.push({ numPr: null, pStyle: ids.rank[2]! })
    paragraphs.push({ numPr: null, pStyle: ids.rank[1]! })
    paragraphs.push({ numPr: null, pStyle: ids.rank[2]! })

    const fixed = apply(paragraphs, planHalfWidthFix(paragraphs, numbering, styles, ids))
    const texts = [...computeListMarkers(fixed, numbering, styles).values()].map((m) => m.text)
    expect(texts.slice(0, 11)).toEqual([
      '第１', '第２', '第３', '第４', '第５', '第６', '第７', '第８', '第９', '第10', '第11'
    ])
    expect(texts.slice(11, 21)).toEqual(['１', '２', '３', '４', '５', '６', '７', '８', '９', '10'])
    // 次のランク１は続き番号 (半角)、その下のランク２は 1 に戻って全角
    expect(texts[21]).toBe('第12')
    expect(texts[22]).toBe('１')
  })

  it('もう一度実行しても結果は同じで、前回の num は残さない', () => {
    const { styles, ids, numbering } = setup()
    const paragraphs: RankParagraph[] = []
    for (let i = 0; i < 12; i++) paragraphs.push({ numPr: null, pStyle: ids.rank[1]! })
    const once = apply(paragraphs, planHalfWidthFix(paragraphs, numbering, styles, ids))
    const countAfterOnce = numbering.instances.size
    const twice = apply(once, planHalfWidthFix(once, numbering, styles, ids))
    expect(numbering.instances.size).toBe(countAfterOnce)
    const texts = [...computeListMarkers(twice, numbering, styles).values()].map((m) => m.text)
    expect(texts.slice(8)).toEqual(['第９', '第10', '第11', '第12'])
  })

  it('10 に届かなければ何も変えない', () => {
    const { styles, ids, numbering } = setup()
    const paragraphs = [1, 1, 2].map((n) => ({ numPr: null, pStyle: ids.rank[n]! }))
    expect(planHalfWidthFix(paragraphs, numbering, styles, ids).size).toBe(0)
  })
})
