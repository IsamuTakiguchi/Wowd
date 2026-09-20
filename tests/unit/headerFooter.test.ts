import { describe, it, expect } from 'vitest'
import {
  toEditableText,
  fromEditableText,
  PAGE_TOKEN,
  PAGES_TOKEN,
  TAB_TOKEN
} from '@core/headerFooter'
import { EMPTY_PARAGRAPH_ATTRS } from '@core/docx/read/paragraph'
import type { WowdDoc, InlineNode } from '@core/model/types'

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
