import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { buildExtensions } from '@renderer/editor/extensions'
import { fromWowdDoc } from '@renderer/editor/serialize/fromWowdDoc'
import { toWowdDoc } from '@renderer/editor/serialize/toWowdDoc'
import type { WowdDoc, BlockNode, InlineNode } from '@core/model/types'
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
      doc: docOf(para({ type: 'rawRun', attrs: { xml: '<w:object/>', label: 'w:object' } })),
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
