import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { buildExtensions } from '@renderer/editor/extensions'
import { fromWowdDoc } from '@renderer/editor/serialize/fromWowdDoc'
import { toWowdDoc } from '@renderer/editor/serialize/toWowdDoc'
import type { WowdDoc, BlockNode, InlineNode, Mark } from '@core/model/types'
import { EMPTY_PARAGRAPH_ATTRS } from '@core/docx/read/paragraph'

/**
 * エディタ経由のラウンドトリップ。
 *
 * モデル層 (readDocx / writeDocx) のテストはこの経路を通らないので、
 * 「ProseMirror のスキーマに無いノードが読み込み時に黙って捨てられる」
 * 種類のバグを検出できない。
 *
 * ProseMirror は未知のノード型を含む JSON を渡されると例外を投げるか、
 * スキーマの content 制約に合わない子を落とす。どちらにせよ利用者から見れば
 * 「文書を開いたら消えていた」になる。実際のスキーマを組み立てて確かめる。
 */

const schema = getSchema(buildExtensions())

function para(...content: InlineNode[]): BlockNode {
  return { type: 'paragraph', attrs: { ...EMPTY_PARAGRAPH_ATTRS }, content }
}

function docOf(...content: BlockNode[]): WowdDoc {
  return { type: 'doc', content }
}

/**
 * 実際にエディタが行う経路を通す。
 * WowdDoc → PM JSON → PMNode (ここでスキーマ検証) → PM JSON → WowdDoc
 */
function throughEditor(doc: WowdDoc): { restored: WowdDoc; error: string | null } {
  try {
    const node = PMNode.fromJSON(schema, fromWowdDoc(doc) as never)
    return { restored: toWowdDoc(node.toJSON() as never), error: null }
  } catch (err) {
    return {
      restored: { type: 'doc', content: [] },
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function nodeTypes(doc: WowdDoc): Set<string> {
  const seen = new Set<string>()
  const walk = (node: { type?: string; content?: unknown[] }): void => {
    if (node.type) seen.add(node.type)
    for (const child of (node.content ?? []) as { type?: string; content?: unknown[] }[]) {
      walk(child)
    }
  }
  doc.content.forEach(walk)
  return seen
}

const RUBY: InlineNode = {
  type: 'ruby',
  attrs: {
    rt: 'かんじ',
    rubyAlign: 'distributeSpace',
    hps: 10,
    hpsRaise: 22,
    hpsBaseText: 21,
    lid: 'ja-JP',
    rtProps: null
  },
  content: [{ type: 'text', text: '漢字' }]
}

const FIELD: InlineNode = {
  type: 'field',
  attrs: { instr: 'PAGE \\* MERGEFORMAT', cachedText: '3', dirty: false }
}

const BOOKMARK: InlineNode = {
  type: 'bookmark',
  attrs: { id: '1', name: '_Toc123', isEnd: false }
}

const BREAK: InlineNode = { type: 'wBreak', attrs: { breakType: 'textWrapping', clear: null } }

const IMAGE: InlineNode = {
  type: 'image',
  attrs: {
    mediaKey: 'word/media/image1.png',
    relId: 'rId5',
    cx: 914400,
    cy: 914400,
    wrap: 'inline',
    align: null,
    name: '図 1',
    descr: '',
    inline: true,
    rawDrawing: '<w:drawing/>'
  }
}

const TABLE: BlockNode = {
  type: 'table',
  attrs: {
    tblStyle: null,
    tblW: null,
    jc: null,
    grid: [2000, 2000],
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
          content: [para({ type: 'text', text: 'セル' })]
        }
      ]
    }
  ]
}

describe('スキーマの網羅性', () => {
  const cases: { label: string; doc: WowdDoc; types: string[] }[] = [
    { label: 'ルビ', doc: docOf(para(RUBY)), types: ['ruby'] },
    { label: 'フィールド', doc: docOf(para(FIELD)), types: ['field'] },
    { label: 'ブックマーク', doc: docOf(para(BOOKMARK)), types: ['bookmark'] },
    { label: '行内改行', doc: docOf(para(BREAK)), types: ['wBreak'] },
    { label: '画像', doc: docOf(para(IMAGE)), types: ['image'] },
    { label: '表', doc: docOf(TABLE), types: ['table', 'tableRow', 'tableCell'] },
    {
      label: '未対応ブロックの退避',
      doc: docOf({ type: 'rawBlock', attrs: { xml: '<w:sdt/>', label: 'w:sdt' } }),
      types: ['rawBlock']
    },
    {
      label: '未対応ランの退避',
      doc: docOf(
        para({ type: 'rawRun', attrs: { xml: '<w:object/>', label: 'w:object', inRun: true } })
      ),
      types: ['rawRun']
    },
    { label: 'タブ', doc: docOf(para({ type: 'wTab', attrs: {} })), types: ['wTab'] },
    { label: '改ページ', doc: docOf({ type: 'pageBreak', attrs: {} }), types: ['pageBreak'] }
  ]

  for (const testCase of cases) {
    it(`${testCase.label} がエディタを通しても失われない`, () => {
      const { restored, error } = throughEditor(testCase.doc)
      expect(error, `スキーマ検証で例外: ${error}`).toBeNull()
      const types = nodeTypes(restored)
      for (const expected of testCase.types) {
        expect(types.has(expected), `${expected} が失われた`).toBe(true)
      }
    })
  }

  it('本文テキストが失われない', () => {
    const { restored, error } = throughEditor(docOf(para({ type: 'text', text: '本文' })))
    expect(error).toBeNull()
    const first = restored.content[0]
    expect(first?.type).toBe('paragraph')
    if (first?.type === 'paragraph') {
      expect(first.content?.[0]).toMatchObject({ type: 'text', text: '本文' })
    }
  })

  it('モデルが作りうるマークがすべてスキーマにある', () => {
    // マークもノードと同じく、1 つでも欠けるとそれを含む文書が読めなくなる。
    // 実際に変更履歴とコメントのマークが抜けていて、本文が丸ごと消えていた
    const revision = { id: 1, author: '校閲者', date: '2026-01-01T00:00:00Z' }
    const marks: Mark[] = [
      { type: 'bold' },
      { type: 'italic' },
      { type: 'underline', attrs: { val: 'single', color: null } },
      { type: 'strike' },
      { type: 'doubleStrike' },
      { type: 'link', attrs: { href: null, anchor: '_Toc1', rId: 'rId9', tooltip: null } },
      { type: 'comment', attrs: { ids: ['1', '2'] } },
      { type: 'insertion', attrs: revision },
      { type: 'deletion', attrs: revision }
    ]

    for (const mark of marks) {
      const doc = docOf(para({ type: 'text', text: '本文', marks: [mark] }))
      const { restored, error } = throughEditor(doc)
      expect(error, `${mark.type}: スキーマ検証で例外 ${error}`).toBeNull()

      const first = restored.content[0]
      expect(first?.type).toBe('paragraph')
      if (first?.type !== 'paragraph') continue
      const text = first.content?.[0]
      expect(text, `${mark.type}: 本文が消えた`).toBeDefined()
      expect(
        text?.type === 'text' && text.marks?.some((m) => m.type === mark.type),
        `${mark.type} が失われた`
      ).toBe(true)
    }
  })

  it('段落記号の挿入・削除がエディタ経由でも失われない', () => {
    // 段落記号はインラインの文字ではないので、マークではなく段落属性で表す。
    // 落とすと Enter や BackSpace だけが履歴に残らなくなる
    const meta = { id: 7, author: '校閲者', date: '2026-01-01T00:00:00Z' }
    const doc = docOf({
      type: 'paragraph',
      attrs: { ...EMPTY_PARAGRAPH_ATTRS, paraMarkRevision: { kind: 'ins' as const, meta } },
      content: [{ type: 'text', text: '段落' }]
    })
    const { restored, error } = throughEditor(doc)
    expect(error).toBeNull()
    const first = restored.content[0]
    expect(first?.type).toBe('paragraph')
    if (first?.type === 'paragraph') {
      expect(first.attrs.paraMarkRevision).toEqual({ kind: 'ins', meta })
    }
  })

  it('複数のマークが同時に載っても失われない', () => {
    const doc = docOf(
      para({
        type: 'text',
        text: '赤入り',
        marks: [
          { type: 'bold' },
          { type: 'comment', attrs: { ids: ['5'] } },
          { type: 'insertion', attrs: { id: 3, author: 'A', date: '2026-01-01T00:00:00Z' } }
        ]
      })
    )
    const { restored, error } = throughEditor(doc)
    expect(error).toBeNull()
    const first = restored.content[0]
    if (first?.type !== 'paragraph') throw new Error('段落が失われた')
    const text = first.content?.[0]
    const types = text?.type === 'text' ? (text.marks ?? []).map((m) => m.type).sort() : []
    expect(types).toEqual(['bold', 'comment', 'insertion'])
  })

  it('複合文書でもすべての要素が残る', () => {
    const doc = docOf(
      para({ type: 'text', text: '見出し前' }),
      TABLE,
      para(RUBY, FIELD, BOOKMARK, BREAK, { type: 'wTab', attrs: {} }),
      { type: 'pageBreak', attrs: {} },
      para(IMAGE)
    )
    const { restored, error } = throughEditor(doc)
    expect(error).toBeNull()
    const types = nodeTypes(restored)
    for (const expected of [
      'table',
      'tableRow',
      'tableCell',
      'ruby',
      'field',
      'bookmark',
      'wBreak',
      'wTab',
      'pageBreak',
      'image'
    ]) {
      expect(types.has(expected), `${expected} が失われた`).toBe(true)
    }
  })
})
