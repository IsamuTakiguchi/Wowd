import { describe, it, expect } from 'vitest'
import {
  search,
  normalizeText,
  flattenDoc,
  nextMatch,
  prevMatch,
  DEFAULT_SEARCH_OPTIONS,
  type SearchOptions
} from '@core/search'
import type { WowdDoc } from '@core/model/types'
import { EMPTY_PARAGRAPH_ATTRS } from '@core/docx/read/paragraph'

const opts = (over: Partial<SearchOptions> = {}): SearchOptions => ({
  ...DEFAULT_SEARCH_OPTIONS,
  ...over
})

function docOf(...paragraphs: string[]): WowdDoc {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph' as const,
      attrs: { ...EMPTY_PARAGRAPH_ATTRS },
      content: [{ type: 'text' as const, text }]
    }))
  }
}

describe('normalizeText', () => {
  it('全角英数を半角に寄せる', () => {
    expect(normalizeText('ＡＢＣ１２３', opts({ matchCase: true }))).toBe('ABC123')
  })

  it('全角スペースを半角に寄せる', () => {
    expect(normalizeText('あ　い', opts({ matchCase: true }))).toBe('あ い')
  })

  it('半角カタカナを全角カタカナに寄せる', () => {
    expect(normalizeText('ﾃｽﾄ', opts({ matchCase: true }))).toBe('テスト')
  })

  it('半角の濁点付きカナは 1 文字に畳めないので変換しない (位置対応を守るため)', () => {
    // ｶ は カ になるが、続く ﾞ は残る。「ｶﾞ」と「ガ」は一致しない
    expect(normalizeText('ｶﾞ', opts({ matchCase: true }))).toBe('カﾞ')
  })

  it('カタカナをひらがなに寄せる', () => {
    expect(normalizeText('カタカナ', opts({ matchCase: true, normalizeKana: true }))).toBe('かたかな')
  })

  it('正規化しても文字数が変わらない (位置対応が崩れないこと)', () => {
    const src = 'ＡＢあカﾃｽﾄ　1'
    const out = normalizeText(src, opts({ normalizeKana: true }))
    expect([...out].length).toBe([...src].length)
  })
})

describe('search', () => {
  it('単純な一致をすべて見つける', () => {
    const m = search('あいうあいう', 'あい', opts())
    expect(m.map((x) => x.from)).toEqual([0, 3])
  })

  it('既定では大文字小文字を区別しない', () => {
    expect(search('Hello hello', 'HELLO', opts())).toHaveLength(2)
    expect(search('Hello hello', 'HELLO', opts({ matchCase: true }))).toHaveLength(0)
  })

  it('全角と半角を同一視して検索できる', () => {
    const m = search('ＡＢＣ と ABC', 'abc', opts())
    expect(m).toHaveLength(2)
    // 元テキスト上の文字が返る
    expect(m[0]?.text).toBe('ＡＢＣ')
    expect(m[1]?.text).toBe('ABC')
  })

  it('半角カナと全角カナを同一視して検索できる', () => {
    const m = search('テストと ﾃｽﾄ', 'テスト', opts())
    expect(m).toHaveLength(2)
    expect(m[1]?.text).toBe('ﾃｽﾄ')
  })

  it('ひらがなとカタカナを同一視して検索できる', () => {
    const m = search('タナカさんと たなか さん', 'たなか', opts({ normalizeKana: true }))
    expect(m).toHaveLength(2)
    expect(m[0]?.text).toBe('タナカ')
  })

  it('完全一致する単語だけに絞れる', () => {
    expect(search('cat category', 'cat', opts({ wholeWord: true }))).toHaveLength(1)
    expect(search('cat category', 'cat', opts({ wholeWord: false }))).toHaveLength(2)
  })

  it('正規表現で検索できる', () => {
    const m = search('第1条 第12条', '第\\d+条', opts({ regex: true }))
    expect(m.map((x) => x.text)).toEqual(['第1条', '第12条'])
  })

  it('壊れた正規表現では例外を投げずに空を返す', () => {
    expect(search('abc', '[', opts({ regex: true }))).toEqual([])
  })

  it('空文字の検索は何も返さない', () => {
    expect(search('abc', '', opts())).toEqual([])
  })

  it('一致が重ならない', () => {
    // 'aa' を 'aaa' から探すと 1 件だけ (0-2)。位置 1 は前の一致に食われる
    expect(search('aaa', 'aa', opts()).map((m) => m.from)).toEqual([0])
  })
})

describe('flattenDoc', () => {
  it('段落を改行で連結し、各文字のブロック番号を返す', () => {
    const flat = flattenDoc(docOf('あい', 'うえ'))
    expect(flat.text).toBe('あい\nうえ')
    expect(flat.blockIndex).toHaveLength(flat.text.length)
    expect(flat.blockIndex[0]).toBe(0)
    expect(flat.blockIndex[flat.text.length - 1]).toBe(1)
  })

  it('表のセル内のテキストも拾う', () => {
    const doc: WowdDoc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: {
            tblStyle: null,
            tblW: null,
            jc: null,
            grid: [100],
            borders: null,
            cellMar: null,
            layout: 'autofit',
            rawTblPr: null
          },
          content: [
            {
              type: 'tableRow',
              attrs: { isHeader: false, height: null, heightRule: null, cantSplit: false, rawTrPr: null },
              content: [
                {
                  type: 'tableCell',
                  attrs: {
                    colspan: 1,
                    rowspan: 1,
                    tcW: null,
                    vAlign: 'top',
                    borders: null,
                    shd: null,
                    rawTcPr: null
                  },
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { ...EMPTY_PARAGRAPH_ATTRS },
                      content: [{ type: 'text', text: 'セル' }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
    expect(flattenDoc(doc).text).toBe('セル')
  })
})

describe('一致の移動', () => {
  // 'あ い あ い あ' の 'あ' は 0, 4, 8 の位置にある
  const matches = search('あ い あ い あ', 'あ', opts())

  it('前提: 一致位置は 0, 4, 8', () => {
    expect(matches.map((m) => m.from)).toEqual([0, 4, 8])
  })

  it('次の一致はカーソル以降で最初のもの', () => {
    expect(nextMatch(matches, 0)?.from).toBe(0)
    expect(nextMatch(matches, 1)?.from).toBe(4)
  })

  it('末尾まで行ったら先頭に戻る', () => {
    expect(nextMatch(matches, 999)?.from).toBe(0)
  })

  it('前の一致はカーソル以前で最後のもの', () => {
    expect(prevMatch(matches, 3)?.from).toBe(0)
    expect(prevMatch(matches, 8)?.from).toBe(4)
  })

  it('先頭より前なら末尾に回る', () => {
    expect(prevMatch(matches, 0)?.from).toBe(8)
  })
})
