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
          done: false
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
