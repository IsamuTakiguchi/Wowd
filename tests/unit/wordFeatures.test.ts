import { describe, it, expect } from 'vitest'
import { nextFontSize } from '@renderer/editor/commands/word'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { REL_TYPE } from '@core/docx/package'
import type { BlockNode } from '@core/model/types'
import { EMPTY_PARAGRAPH_ATTRS } from '@core/docx/read/paragraph'
import { readFixture } from './helpers'
import { strFromU8, unzipSync } from 'fflate'

describe('フォントサイズの拡大・縮小 (Word の一覧どおり)', () => {
  it.each([
    [10.5, 1, 11],
    [12, 1, 14],
    [28, 1, 36],
    [72, 1, 80],
    [12, -1, 11],
    [10.5, -1, 10],
    [8, -1, 7],
    [13, 1, 14],
    [13, -1, 12]
  ] as const)('%d pt → %d 方向 → %d pt', (current, direction, expected) => {
    expect(nextFontSize(current, direction)).toBe(expected)
  })
})

describe('ハイパーリンク', () => {
  it('新しいリンクの関係 (TargetMode="External") を .rels に足す。行き先は XML として逃がす', () => {
    const doc = readDocx(readFixture('01-plain.docx'))
    const rels = doc.resources.rels
    const id = `rId${rels.nextId++}`
    const url = 'https://example.com/a?b=1&c=2'
    rels.byId.set(id, { id, type: REL_TYPE.hyperlink, target: url, targetMode: 'External' })
    const paragraph: BlockNode = {
      type: 'paragraph',
      attrs: { ...EMPTY_PARAGRAPH_ATTRS },
      content: [
        {
          type: 'text',
          text: 'リンク',
          marks: [{ type: 'link', attrs: { href: url, anchor: null, rId: id, tooltip: null } }]
        }
      ]
    }
    const saved = writeDocx({ ...doc, doc: { type: 'doc', content: [paragraph] } }, doc.pkg)
    const files = unzipSync(saved)
    const relsXml = strFromU8(files['word/_rels/document.xml.rels']!)
    expect(relsXml).toContain(`Id="${id}"`)
    expect(relsXml).toContain('Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"')
    expect(strFromU8(files['word/document.xml']!)).toContain(`<w:hyperlink r:id="${id}"`)

    // 開き直すと同じ行き先
    const reread = readDocx(saved)
    expect(reread.resources.rels.byId.get(id)?.target).toBe(url)
    // もう一度保存しても関係は増えない
    const again = strFromU8(unzipSync(writeDocx(reread, reread.pkg))['word/_rels/document.xml.rels']!)
    expect(again.split(`Id="${id}"`).length - 1).toBe(1)
  })
})
