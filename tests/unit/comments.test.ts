import { describe, it, expect } from 'vitest'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { threadComments, nextCommentId, newParaId } from '@core/docx/read/comments'
import { readFixture } from './helpers'

describe('comments.xml の読み込み', () => {
  it('コメントの本文と著者を読む', () => {
    const { resources } = readDocx(readFixture('14-comments.docx'))
    expect(resources.comments.size).toBe(3)

    const first = resources.comments.get('0')
    expect(first?.author).toBe('校閲者A')
    expect(first?.initials).toBe('A')
    expect(first?.date).toContain('2026-01-01')

    const text = first?.body.content
      .flatMap((b) => (b.type === 'paragraph' ? (b.content ?? []) : []))
      .map((n) => (n.type === 'text' ? n.text : ''))
      .join('')
    expect(text).toBe('ここは検討が必要です。')
  })

  it('スレッドの親子関係を commentsExtended から解決する', () => {
    const { resources } = readDocx(readFixture('14-comments.docx'))
    // id=1 は id=0 への返信
    expect(resources.comments.get('1')?.parentId).toBe('0')
    expect(resources.comments.get('0')?.parentId).toBeNull()
  })

  it('解決済みの状態を読む', () => {
    const { resources } = readDocx(readFixture('14-comments.docx'))
    expect(resources.comments.get('2')?.done).toBe(true)
    expect(resources.comments.get('0')?.done).toBe(false)
  })

  it('本文側のコメント範囲がマークとして付く', () => {
    const { doc } = readDocx(readFixture('14-comments.docx'))
    const marked = doc.content
      .flatMap((b) => (b.type === 'paragraph' ? (b.content ?? []) : []))
      .filter((n) => n.type === 'text' && n.marks?.some((m) => m.type === 'comment'))
    expect(marked.length).toBeGreaterThanOrEqual(2)
  })

  it('コメントが無い文書でも壊れない', () => {
    const { resources } = readDocx(readFixture('01-plain.docx'))
    expect(resources.comments.size).toBe(0)
  })
})

describe('threadComments', () => {
  it('親と返信をまとめる', () => {
    const { resources } = readDocx(readFixture('14-comments.docx'))
    const threads = threadComments(resources.comments)
    // スレッドは 2 本 (id=0 とその返信、id=2 単独)
    expect(threads).toHaveLength(2)
    const withReply = threads.find((t) => t.length > 1)
    expect(withReply?.[0]?.id).toBe('0')
    expect(withReply?.[1]?.id).toBe('1')
  })

  it('親が存在しない返信は独立したスレッドにする', () => {
    const comments = new Map([
      [
        '5',
        {
          id: '5',
          author: 'A',
          initials: '',
          date: '2026-01-01',
          body: { type: 'doc' as const, content: [] },
          parentId: '999',
          done: false,
          refRPr: null
        }
      ]
    ])
    expect(threadComments(comments)).toHaveLength(1)
  })
})

describe('コメントの書き出し', () => {
  it('コメントを書き直しても内容が保たれる', () => {
    const doc = readDocx(readFixture('14-comments.docx'))
    const saved = writeDocx(doc, doc.pkg, { commentsChanged: true })
    const after = readDocx(saved)

    expect(after.resources.comments.size).toBe(doc.resources.comments.size)
    for (const [id, before] of doc.resources.comments) {
      const now = after.resources.comments.get(id)
      expect(now, `コメント ${id} が失われた`).toBeDefined()
      expect(now!.author).toBe(before.author)
      expect(now!.parentId, `コメント ${id} のスレッドが壊れた`).toBe(before.parentId)
      expect(now!.done, `コメント ${id} の解決状態が変わった`).toBe(before.done)
    }
  })

  it('コメントを触らなければ comments.xml はバイト一致のまま', () => {
    const doc = readDocx(readFixture('14-comments.docx'))
    const saved = writeDocx(doc, doc.pkg)
    const before = doc.pkg.parts.get('word/comments.xml')!
    const after = readDocx(saved).resources.rawParts.get('word/comments.xml')!
    expect(Array.from(after)).toEqual(Array.from(before))
  })
})

describe('ID の発番', () => {
  it('既存と衝突しないコメント ID を返す', () => {
    const { resources } = readDocx(readFixture('14-comments.docx'))
    const id = nextCommentId(resources.comments)
    expect(resources.comments.has(id)).toBe(false)
  })

  it('段落 ID は 8 桁の 16 進で 0 ではない', () => {
    for (let i = 0; i < 20; i++) {
      const id = newParaId()
      expect(id).toMatch(/^[0-9A-F]{8}$/)
      expect(Number.parseInt(id, 16)).toBeGreaterThan(0)
    }
  })
})

describe('コメントの錨 (範囲と参照)', () => {
  /**
   * 1 つのコメントに錨は 1 つだけ。
   *
   * コメント範囲の開閉を**段落ごと**に持っていたので、複数段落にまたがる
   * コメントが段落ごとに開いて閉じ、同じ w:id の
   * commentRangeStart / End / commentReference が段落数ぶん出ていた。
   * Word は 1 つの id に 1 つの範囲しか想定しないので「修復しますか」になる。
   *
   * **XSD は通ってしまう** (どちらも出現回数に制約が無い) ので、
   * 実機 Word か、この手の数の検査でしか捕まえられない。
   */
  const counts = (xml: string, tag: string, id: string): number =>
    xml.split(`<${tag} w:id="${id}"`).length - 1

  it('段落をまたいでも範囲は 1 組だけになる', () => {
    const loaded = readDocx(readFixture('14-comments.docx'))
    const mark = { type: 'comment', attrs: { ids: ['0'] } } as never
    const attrs = (loaded.doc.content[0] as { attrs: unknown }).attrs as never
    const content = ['一つ目の段落。', '二つ目の段落。', '三つ目の段落。'].map((text) => ({
      type: 'paragraph' as const,
      attrs,
      content: [{ type: 'text' as const, text, marks: [mark] }]
    }))

    const saved = readDocx(
      writeDocx({ ...loaded, doc: { type: 'doc', content } }, loaded.pkg, {}),
      null
    )
    const xml = new TextDecoder().decode(saved.pkg.parts.get(saved.resources.documentPartName)!)

    expect(counts(xml, 'w:commentRangeStart', '0'), '範囲の開始が複数ある').toBe(1)
    expect(counts(xml, 'w:commentRangeEnd', '0'), '範囲の終了が複数ある').toBe(1)
    expect(counts(xml, 'w:commentReference', '0'), '参照が複数ある').toBe(1)

    // 3 段落すべてが範囲の内側にあること
    const start = xml.indexOf('<w:commentRangeStart w:id="0"')
    const end = xml.indexOf('<w:commentRangeEnd w:id="0"')
    for (const text of ['一つ目の段落。', '二つ目の段落。', '三つ目の段落。']) {
      const at = xml.indexOf(text)
      expect(at > start && at < end, `${text} が範囲の外にある`).toBe(true)
    }
  })

  it('返信にも範囲と参照が付く', () => {
    // 14-comments.docx の id=1 は id=0 への返信。
    // 返信は本文に印を持たないので、親の範囲に相乗りさせる必要がある。
    // 参照が無いコメントは錨が無く、Word が壊れた文書として扱う
    const loaded = readDocx(readFixture('14-comments.docx'))
    const bytes = writeDocx(loaded, loaded.pkg, {})
    const xml = new TextDecoder().decode(
      readDocx(bytes, null).pkg.parts.get(loaded.resources.documentPartName)!
    )

    for (const id of ['0', '1', '2']) {
      expect(counts(xml, 'w:commentReference', id), `コメント ${id} の参照が 1 つでない`).toBe(1)
      expect(counts(xml, 'w:commentRangeStart', id), `コメント ${id} の範囲が 1 つでない`).toBe(1)
    }

    // 返信の範囲は親と同じ場所から始まる
    expect(xml).toContain('<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/>')
  })
})
