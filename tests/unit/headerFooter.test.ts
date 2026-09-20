import { describe, it, expect } from 'vitest'
import {
  toEditableText,
  fromEditableText,
  editableLines,
  applyEditableLines,
  isRich,
  PAGE_TOKEN,
  PAGES_TOKEN,
  TAB_TOKEN
} from '@core/headerFooter'
import { EMPTY_PARAGRAPH_ATTRS } from '@core/docx/read/paragraph'
import type { WowdDoc, InlineNode, BlockNode, TableCellNode } from '@core/model/types'

function doc(...lines: InlineNode[][]): WowdDoc {
  return {
    type: 'doc',
    content: lines.map((content) => ({
      type: 'paragraph',
      attrs: { ...EMPTY_PARAGRAPH_ATTRS },
      content
    }))
  }
}

describe('ヘッダー / フッターの平文化', () => {
  it('文字だけの段落を行に落とす', () => {
    const result = toEditableText(doc([{ type: 'text', text: '社外秘' }]))
    expect(result).toEqual({ text: '社外秘', jc: null })
  })

  it('PAGE と NUMPAGES をトークンにする', () => {
    const result = toEditableText(
      doc([
        { type: 'field', attrs: { instr: ' PAGE ', cachedText: '3', dirty: false } },
        { type: 'text', text: ' / ' },
        { type: 'field', attrs: { instr: ' NUMPAGES ', cachedText: '9', dirty: false } }
      ])
    )
    expect(result?.text).toBe(`${PAGE_TOKEN} / ${PAGES_TOKEN}`)
  })

  it('タブをトークンにする', () => {
    const result = toEditableText(
      doc([{ type: 'text', text: '左' }, { type: 'wTab', attrs: {} }, { type: 'text', text: '右' }])
    )
    expect(result?.text).toBe(`左${TAB_TOKEN}右`)
  })

  it('配置が段落ごとに違えば null にする', () => {
    const source: WowdDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { ...EMPTY_PARAGRAPH_ATTRS, jc: 'center' },
          content: [{ type: 'text', text: 'あ' }]
        },
        {
          type: 'paragraph',
          attrs: { ...EMPTY_PARAGRAPH_ATTRS, jc: 'right' },
          content: [{ type: 'text', text: 'い' }]
        }
      ]
    }
    expect(toEditableText(source)?.jc).toBeNull()
  })

  it('全段落で同じ配置ならその値を返す', () => {
    const source: WowdDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { ...EMPTY_PARAGRAPH_ATTRS, jc: 'center' },
          content: [{ type: 'text', text: 'あ' }]
        }
      ]
    }
    expect(toEditableText(source)?.jc).toBe('center')
  })

  it('凝ったヘッダーは編集させない', () => {
    // 画像を含むヘッダーは平文に落とせない。
    // 無理に落とすと、開いて保存しただけで画像が消える
    const withImage = doc([
      {
        type: 'image',
        attrs: {
          mediaKey: 'word/media/image1.png',
          relId: 'rId9',
          cx: 100,
          cy: 100,
          wrap: 'inline',
        align: null,
          name: '',
          descr: '',
          inline: true,
          rawDrawing: null
        }
      }
    ])
    expect(toEditableText(withImage)).toBeNull()

    // 表を含むヘッダーも同じ
    const withTable: WowdDoc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: {
            tblStyle: null,
            tblW: { value: 0, type: 'auto' },
            jc: null,
            grid: [100],
            borders: null,
            cellMar: null,
            layout: 'autofit',
            rawTblPr: null
          },
          content: []
        }
      ]
    }
    expect(toEditableText(withTable)).toBeNull()
  })

  it('知らないフィールドがあれば編集させない', () => {
    const withDate = doc([
      { type: 'field', attrs: { instr: ' DATE \\@ "yyyy/MM/dd" ', cachedText: '', dirty: false } }
    ])
    expect(toEditableText(withDate)).toBeNull()
  })

  it('ヘッダーが無い文書は空文字として扱う', () => {
    expect(toEditableText(null)).toEqual({ text: '', jc: null })
  })
})

describe('平文からの組み立て', () => {
  it('行が段落になる', () => {
    const built = fromEditableText('1 行目\n2 行目', null)
    expect(built.content).toHaveLength(2)
  })

  it('空文字でも段落を 1 つ残す', () => {
    // 中身の無い w:hdr は Word が嫌う
    expect(fromEditableText('', null).content).toHaveLength(1)
  })

  it('トークンがフィールドとタブになる', () => {
    const built = fromEditableText(`左${TAB_TOKEN}${PAGE_TOKEN} / ${PAGES_TOKEN}`, 'center')
    const first = built.content[0]
    if (first?.type !== 'paragraph') throw new Error('段落でない')

    expect(first.attrs.jc).toBe('center')
    const types = (first.content ?? []).map((n) => n.type)
    expect(types).toEqual(['text', 'wTab', 'field', 'text', 'field'])

    const page = first.content?.[2]
    const pages = first.content?.[4]
    expect(page?.type === 'field' && page.attrs.instr).toMatch(/\bPAGE\b/)
    expect(pages?.type === 'field' && pages.attrs.instr).toMatch(/\bNUMPAGES\b/)
    // Word に再計算させる。こちらの行分割は Word と一致しない
    expect(page?.type === 'field' && page.attrs.dirty).toBe(true)
  })

  it('平文 → 組み立て → 平文 で元に戻る', () => {
    const text = `社外秘${TAB_TOKEN}${PAGE_TOKEN} / ${PAGES_TOKEN}\n2 行目`
    expect(toEditableText(fromEditableText(text, 'right'))).toEqual({ text, jc: 'right' })
  })
})

describe('表や画像を含むヘッダーの編集', () => {
  /**
   * 平文に潰す方式は、潰せない中身があると諦めるしかない。
   * 潰して書き戻せば表も画像も消えるので、諦めるのは正しい。
   *
   * だが社名入りのレターヘッドのように、
   * **表や画像は触らず文字だけ直したい**ことのほうが多い。
   * 道筋で段落を指して中身だけ差し替えれば、構造は一切動かない。
   */
  const para = (text: string): BlockNode => ({
    type: 'paragraph',
    attrs: { ...EMPTY_PARAGRAPH_ATTRS },
    content: text ? [{ type: 'text', text }] : []
  })

  const cell = (blocks: BlockNode[]): TableCellNode => ({
    type: 'tableCell',
    attrs: {
      colspan: 1,
      rowspan: 1,
      tcW: null,
      borders: null,
      shd: null,
      vAlign: 'top',
      rawTcPr: null
    },
    content: blocks
  })

  /** 左に社名、右に画像を置いたレターヘッド */
  function letterhead(): WowdDoc {
    const image: BlockNode = {
      type: 'paragraph',
      attrs: { ...EMPTY_PARAGRAPH_ATTRS },
      content: [
        {
          type: 'image',
          attrs: {
            mediaKey: 'logo',
            relId: 'rId9',
            cx: 100,
            cy: 100,
            wrap: 'inline',
            align: null,
            name: 'logo',
            descr: '',
            inline: true,
            rawDrawing: '<w:drawing/>'
          }
        }
      ]
    }
    return {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: {
            grid: [2000, 2000],
            tblW: null,
            jc: null,
            borders: null,
            layout: 'autofit',
            cellMar: null,
            tblStyle: null,
            rawTblPr: null
          },
          content: [
            {
              type: 'tableRow',
              attrs: {
                height: null,
                heightRule: null,
                isHeader: false,
                cantSplit: false,
                rawTrPr: null
              },
              content: [cell([para('株式会社◯◯')]), cell([image])]
            }
          ]
        },
        para('社外秘')
      ]
    }
  }

  it('表を含むヘッダーは平文にできない', () => {
    expect(toEditableText(letterhead())).toBe(null)
    expect(isRich(letterhead())).toBe(true)
  })

  it('表のセルの中の段落まで列挙する', () => {
    const lines = editableLines(letterhead())
    expect(lines.map((l) => l.text)).toEqual(['株式会社◯◯', '', '社外秘'])
    expect(lines[0]?.inTable).toBe(true)
    expect(lines[2]?.inTable).toBe(false)
  })

  it('画像を含む段落は直せないものとして出す', () => {
    // 出さないと「なぜか一部だけ直せない」に見える
    const lines = editableLines(letterhead())
    expect(lines[1]?.editable).toBe(false)
    expect(lines[0]?.editable).toBe(true)
  })

  it('文字だけ差し替えても表と画像が残る', () => {
    const doc = letterhead()
    const lines = editableLines(doc)
    lines[0]!.text = '△△法律事務所'
    lines[2]!.text = '取扱注意'

    const next = applyEditableLines(doc, lines)

    // 構造は動かない
    expect(next.content[0]?.type).toBe('table')
    const table = next.content[0] as Extract<BlockNode, { type: 'table' }>
    const first = table.content[0]?.content[0]?.content[0]
    expect(first?.type).toBe('paragraph')
    expect((first as Extract<BlockNode, { type: 'paragraph' }>).content?.[0]).toEqual({
      type: 'text',
      text: '△△法律事務所'
    })

    // 画像はそのまま
    const imageCell = table.content[0]?.content[1]?.content[0]
    const inline = (imageCell as Extract<BlockNode, { type: 'paragraph' }>).content?.[0]
    expect(inline?.type).toBe('image')

    const last = next.content[1] as Extract<BlockNode, { type: 'paragraph' }>
    expect(last.content?.[0]).toEqual({ type: 'text', text: '取扱注意' })
  })

  it('直せない行に手を入れても無視する', () => {
    const doc = letterhead()
    const lines = editableLines(doc)
    lines[1]!.text = 'これで画像を潰してはいけない'

    const next = applyEditableLines(doc, lines)
    const table = next.content[0] as Extract<BlockNode, { type: 'table' }>
    const imageCell = table.content[0]?.content[1]?.content[0]
    const inline = (imageCell as Extract<BlockNode, { type: 'paragraph' }>).content?.[0]
    expect(inline?.type, '画像が文字で上書きされた').toBe('image')
  })

  it('ページ番号のトークンも使える', () => {
    const doc: WowdDoc = { type: 'doc', content: [para('こんにちは')] }
    const lines = editableLines(doc)
    lines[0]!.text = `- ${PAGE_TOKEN} -`
    const next = applyEditableLines(doc, lines)
    const content = (next.content[0] as Extract<BlockNode, { type: 'paragraph' }>).content ?? []
    expect(content.map((n) => n.type)).toEqual(['text', 'field', 'text'])
  })
})
