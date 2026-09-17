import { describe, it, expect } from 'vitest'
import {
  collectHeadings,
  headingLevelOf,
  buildToc,
  applyToc,
  findExistingToc,
  withTocBookmarks,
  tocInstruction
} from '@core/toc'
import { EMPTY_PARAGRAPH_ATTRS } from '@core/docx/read/paragraph'
import type { WowdDoc, BlockNode } from '@core/model/types'
import { readDocx } from '@core/docx/read'
import { readFixture } from './helpers'

function para(text: string, attrs: Partial<typeof EMPTY_PARAGRAPH_ATTRS> = {}): BlockNode {
  return {
    type: 'paragraph',
    attrs: { ...EMPTY_PARAGRAPH_ATTRS, ...attrs },
    content: [{ type: 'text', text }]
  }
}

function docOf(...content: BlockNode[]): WowdDoc {
  return { type: 'doc', content }
}

const SAMPLE = docOf(
  para('第1章 総則', { pStyle: 'Heading1', outlineLvl: 0 }),
  para('本文です。'),
  para('第1節 目的', { pStyle: 'Heading2', outlineLvl: 1 }),
  para('本文です。'),
  para('第2章 実施', { pStyle: 'Heading1', outlineLvl: 0 })
)

describe('headingLevelOf', () => {
  it('outlineLvl からレベルを求める (0 始まり → 1 始まり)', () => {
    expect(headingLevelOf(para('見出し', { outlineLvl: 0 }))).toBe(1)
    expect(headingLevelOf(para('見出し', { outlineLvl: 2 }))).toBe(3)
  })

  it('outlineLvl が無ければスタイル名から求める', () => {
    expect(headingLevelOf(para('見出し', { pStyle: 'Heading2' }))).toBe(2)
  })

  it('見出しでない段落は null', () => {
    expect(headingLevelOf(para('本文'))).toBeNull()
  })
})

describe('collectHeadings', () => {
  it('見出しだけを集める', () => {
    const entries = collectHeadings(SAMPLE)
    expect(entries.map((e) => e.text)).toEqual(['第1章 総則', '第1節 目的', '第2章 実施'])
    expect(entries.map((e) => e.level)).toEqual([1, 2, 1])
  })

  it('レベルの範囲で絞れる', () => {
    expect(collectHeadings(SAMPLE, { maxLevel: 1 }).map((e) => e.text)).toEqual([
      '第1章 総則',
      '第2章 実施'
    ])
  })

  it('空の見出しは飛ばす', () => {
    const doc = docOf(para('', { pStyle: 'Heading1' }), para('本文'))
    expect(collectHeadings(doc)).toHaveLength(0)
  })

  it('ページ番号を受け取れる', () => {
    const entries = collectHeadings(SAMPLE, { pageOf: (i) => i + 1 })
    expect(entries[0]?.page).toBe(1)
    expect(entries[2]?.page).toBe(5)
  })

  it('ブックマーク名が重複しない', () => {
    const names = collectHeadings(SAMPLE).map((e) => e.bookmark)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('buildToc', () => {
  it('先頭に見出しと TOC フィールドを置く', () => {
    const blocks = buildToc(collectHeadings(SAMPLE))
    const first = blocks[0]
    expect(first?.type).toBe('paragraph')
    if (first?.type !== 'paragraph') return

    // フィールドの結果は空なので、見出しの文字が無いと画面上で幅ゼロになる
    const title = first.content?.[0]
    expect(title?.type === 'text' && title.text).toBe('目次')

    const field = first.content?.[1]
    expect(field?.type).toBe('field')
    if (field?.type === 'field') {
      expect(field.attrs.instr).toContain('TOC')
      // Word に再計算させる。こちらの行分割は Word と一致しない
      expect(field.attrs.dirty).toBe(true)
    }
  })

  it('各行にリンクとページ番号フィールドを置く', () => {
    const entries = collectHeadings(SAMPLE, { pageOf: () => 3 })
    const blocks = buildToc(entries)
    const line = blocks[1]
    if (line?.type !== 'paragraph') throw new Error('目次の行が無い')

    const text = line.content?.[0]
    expect(text?.type === 'text' && text.marks?.[0]?.type).toBe('link')

    const field = line.content?.[2]
    expect(field?.type).toBe('field')
    if (field?.type === 'field') {
      expect(field.attrs.instr).toContain('PAGEREF')
      expect(field.attrs.cachedText).toBe('3')
    }
  })

  it('レベルごとに字下げする', () => {
    const blocks = buildToc(collectHeadings(SAMPLE))
    const level1 = blocks[1]
    const level2 = blocks[2]
    if (level1?.type !== 'paragraph' || level2?.type !== 'paragraph') throw new Error('行が無い')
    expect(level1.attrs.ind?.leftChars).toBe(0)
    expect(level2.attrs.ind?.leftChars).toBe(200)
  })

  it('スタイル名は Word のものに合わせる', () => {
    const blocks = buildToc(collectHeadings(SAMPLE))
    const line = blocks[1]
    if (line?.type !== 'paragraph') throw new Error('行が無い')
    expect(line.attrs.pStyle).toBe('TOC1')
  })
})

describe('withTocBookmarks', () => {
  it('見出しをブックマークで囲む', () => {
    const entries = collectHeadings(SAMPLE)
    const doc = withTocBookmarks(SAMPLE, entries)
    const heading = doc.content[0]
    if (heading?.type !== 'paragraph') throw new Error('見出しが無い')
    expect(heading.content?.[0]?.type).toBe('bookmark')
    expect(heading.content?.[heading.content.length - 1]?.type).toBe('bookmark')
  })

  it('二重に付けない', () => {
    const entries = collectHeadings(SAMPLE)
    const once = withTocBookmarks(SAMPLE, entries)
    const twice = withTocBookmarks(once, entries)
    const heading = twice.content[0]
    if (heading?.type !== 'paragraph') throw new Error('見出しが無い')
    const bookmarks = (heading.content ?? []).filter((n) => n.type === 'bookmark')
    expect(bookmarks).toHaveLength(2)
  })

  it('見出し以外は触らない', () => {
    const doc = withTocBookmarks(SAMPLE, collectHeadings(SAMPLE))
    expect(doc.content[1]).toEqual(SAMPLE.content[1])
  })
})

describe('applyToc', () => {
  it('指定した位置に目次を挿入する', () => {
    const entries = collectHeadings(SAMPLE)
    const doc = applyToc(SAMPLE, entries, 0)
    expect(findExistingToc(doc)).not.toBeNull()
    // 元の本文は残る
    const texts = doc.content
      .filter((b) => b.type === 'paragraph')
      .map((b) => (b.type === 'paragraph' ? (b.content ?? []) : []))
      .flat()
      .filter((n) => n.type === 'text')
      .map((n) => (n.type === 'text' ? n.text : ''))
    expect(texts).toContain('第1章 総則')
    expect(texts).toContain('本文です。')
  })

  it('既存の目次があれば差し替える (二重に作らない)', () => {
    const entries = collectHeadings(SAMPLE)
    const once = applyToc(SAMPLE, entries, 0)
    const twice = applyToc(once, collectHeadings(once), 0)

    const tocFields = twice.content
      .filter((b) => b.type === 'paragraph')
      .flatMap((b) => (b.type === 'paragraph' ? (b.content ?? []) : []))
      .filter((n) => n.type === 'field' && /\bTOC\b/.test(n.attrs.instr))
    expect(tocFields).toHaveLength(1)
  })
})

describe('tocInstruction', () => {
  it('Word が認識する形の命令を作る', () => {
    const instr = tocInstruction(1, 3)
    expect(instr).toContain('TOC')
    expect(instr).toContain('\\o "1-3"')
    expect(instr).toContain('\\h')
  })
})

describe('実ファイル', () => {
  it('見出しを含む文書から目次を作れる', () => {
    const { doc } = readDocx(readFixture('05-kitchen-sink.docx'))
    const entries = collectHeadings(doc)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.map((e) => e.text)).toContain('見出し 1')
  })
})
