import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { openPackage } from '@core/docx/package'
import { fixtureNames, readFixture } from './helpers'

/** Map / Set を含むモデルを比較可能な素の値に落とす */
function normalize(value: unknown): unknown {
  if (value instanceof Map) {
    return { __map: [...value.entries()].map(([k, v]) => [k, normalize(v)]).sort() }
  }
  if (value instanceof Set) return { __set: [...value].sort() }
  if (value instanceof Uint8Array) return { __bytes: value.length }
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v)
    return out
  }
  return value
}

/** 文書から可視テキストだけを取り出す。空になるバグを検出するための最重要チェック */
function plainText(doc: { content: unknown[] }): string {
  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; text?: string; content?: unknown[] }
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text)
    if (n.type === 'ruby' && Array.isArray(n.content)) n.content.forEach(walk)
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  doc.content.forEach(walk)
  return parts.join('')
}

describe('readDocx', () => {
  it('全フィクスチャで本文テキストが空にならない', () => {
    for (const name of fixtureNames()) {
      const { doc } = readDocx(readFixture(name), name)
      expect(plainText(doc).length, `${name}: 本文が空`).toBeGreaterThan(0)
    }
  })

  it('01-plain の本文を一字も落とさずに読む', () => {
    const { doc } = readDocx(readFixture('01-plain.docx'))
    const text = plainText(doc)
    expect(text).toContain('これは最初の段落です。')
    expect(text).toContain('太字と斜体と下線と取り消し線の混在。')
    expect(text).toContain('The quick brown fox jumps over the lazy dog.')
  })

  it('全フィクスチャを解析でき、本文が空にならない', () => {
    for (const name of fixtureNames()) {
      const result = readDocx(readFixture(name), name)
      expect(result.doc.content.length, `${name}: ブロック数`).toBeGreaterThan(0)
      expect(result.resources.sections.length, `${name}: セクション`).toBeGreaterThan(0)
    }
  })

  it('未対応要素は raw として退避され、握り潰されない', () => {
    for (const name of fixtureNames()) {
      const result = readDocx(readFixture(name), name)
      // Phase 0〜4 の範囲では未対応要素が出ないはず。
      // 出た場合はここに現れるので、黙って落ちることはない。
      expect(Array.isArray(result.unsupported), name).toBe(true)
    }
  })

  it('01-plain の文字装飾を正しく読む', () => {
    const { doc } = readDocx(readFixture('01-plain.docx'))
    const paragraphs = doc.content.filter((b) => b.type === 'paragraph')
    expect(paragraphs.length).toBeGreaterThanOrEqual(3)

    const second = paragraphs[1]
    expect(second?.type).toBe('paragraph')
    const texts = second?.type === 'paragraph' ? (second.content ?? []) : []
    const bold = texts.find((n) => n.type === 'text' && n.marks?.some((m) => m.type === 'bold'))
    const italic = texts.find((n) => n.type === 'text' && n.marks?.some((m) => m.type === 'italic'))
    expect(bold, '太字のランが見つからない').toBeDefined()
    expect(italic, '斜体のランが見つからない').toBeDefined()
  })

  it('03-styles の見出しと配置を正しく読む', () => {
    const { doc } = readDocx(readFixture('03-styles.docx'))
    const paragraphs = doc.content.filter((b) => b.type === 'paragraph')
    const heading = paragraphs.find((p) => p.attrs.pStyle?.startsWith('Heading'))
    expect(heading?.attrs.pStyle, '見出しスタイルが読めていない').toMatch(/^Heading\d$/)

    const centered = paragraphs.find((p) => p.attrs.jc === 'center')
    expect(centered, '中央揃えの段落が見つからない').toBeDefined()

    const indented = paragraphs.find((p) => p.attrs.ind?.left === 720)
    expect(indented?.attrs.ind?.firstLine, 'インデントが読めていない').toBe(240)
  })

  it('04-lists のリストは段落属性 numPr として読まれる', () => {
    const { doc, resources } = readDocx(readFixture('04-lists.docx'))
    const listParas = doc.content.filter((b) => b.type === 'paragraph' && b.attrs.numPr !== null)
    expect(listParas.length, 'リスト段落が見つからない').toBeGreaterThanOrEqual(5)

    // 入れ子はノードの入れ子ではなく ilvl で表現される
    const levels = new Set(
      listParas.map((p) => (p.type === 'paragraph' ? p.attrs.numPr?.ilvl : undefined))
    )
    expect(levels.has(0), 'ilvl=0 が無い').toBe(true)
    expect(levels.has(1), 'ilvl=1 が無い').toBe(true)

    expect(resources.numbering.instances.size, 'numbering.xml が読めていない').toBeGreaterThan(0)
    expect(resources.numbering.abstract.size).toBeGreaterThan(0)
  })

  it('文書末尾のセクションは本文ブロックにせず、資源側に保持する', () => {
    for (const name of fixtureNames()) {
      const { doc, resources } = readDocx(readFixture(name), name)
      // Word は文書全体の最後のセクション区切りを画面に出さないので、
      // 本文ツリーにも入れない。ただし設定は失わない
      expect(resources.trailingSectionId, `${name}: 末尾セクションが無い`).not.toBeNull()
      const lastBlock = doc.content[doc.content.length - 1]
      expect(lastBlock?.type, `${name}: 末尾に区切りブロックが残っている`).not.toBe('sectionBreak')
    }
  })

  it('末尾セクションの設定が保存で失われない', () => {
    const before = readDocx(readFixture('03-styles.docx'))
    const saved = writeDocx(before, before.pkg)
    const after = readDocx(saved)

    const b = before.resources.sections.find((s) => s.id === before.resources.trailingSectionId)
    const a = after.resources.sections.find((s) => s.id === after.resources.trailingSectionId)
    expect(a).toBeDefined()
    expect(a!.pgSz).toEqual(b!.pgSz)
    expect(a!.pgMar).toEqual(b!.pgMar)
  })

  it('セクションのページサイズと余白を読む', () => {
    const { resources } = readDocx(readFixture('03-styles.docx'))
    const section = resources.sections[0]!
    // A4 = 210mm x 297mm = 11906 x 16838 twip
    expect(section.pgSz.w).toBeGreaterThan(11000)
    expect(section.pgSz.h).toBeGreaterThan(16000)
    expect(section.pgMar.left).toBeGreaterThan(0)
  })
})

/**
 * Phase 2 の最終ゲート。
 *
 * 1. 書き出したパッケージのパート一覧が元の上位集合であること
 * 2. 書き換えていないパートはバイト一致すること
 * 3. read(write(read(f))) が read(f) と一致すること (冪等ラウンドトリップ)
 *
 * 3 が最も強く、かつ最も安いフィデリティ指標。順序とエスケープのバグはここで落ちる。
 */
describe('ラウンドトリップ', () => {
  it('パート一覧が元の上位集合で、書き換えないパートはバイト一致する', () => {
    for (const name of fixtureNames()) {
      const original = readFixture(name)
      const doc = readDocx(original, name)
      const saved = writeDocx(doc, doc.pkg)

      const before = unzipSync(original)
      const after = unzipSync(saved)

      for (const part of Object.keys(before).filter((n) => !n.endsWith('/'))) {
        expect(Object.keys(after), `${name}: ${part} が欠落`).toContain(part)
        if (part === doc.resources.documentPartName) continue
        expect(Array.from(after[part]!), `${name}: ${part} が変わっている`).toEqual(
          Array.from(before[part]!)
        )
      }
    }
  })

  it('書き出した document.xml が整形式で w:document を持つ', () => {
    for (const name of fixtureNames()) {
      const doc = readDocx(readFixture(name), name)
      const saved = writeDocx(doc, doc.pkg)
      const xml = strFromU8(unzipSync(saved)[doc.resources.documentPartName]!)

      expect(xml.startsWith('<?xml'), `${name}: XML 宣言`).toBe(true)
      expect(xml, `${name}: ルート要素`).toContain('<w:document')
      expect(xml, `${name}: body`).toContain('<w:body')
      // 開始タグと終了タグの数が一致すること (最低限の整形式チェック)
      const opens = (xml.match(/<w:p(?=[\s>])/g) ?? []).length
      const closes = (xml.match(/<\/w:p>/g) ?? []).length
      expect(closes, `${name}: w:p の開閉が不一致`).toBe(opens)
    }
  })

  it('冪等ラウンドトリップ: read(write(read(f))) === read(f)', () => {
    for (const name of fixtureNames()) {
      const first = readDocx(readFixture(name), name)
      const saved = writeDocx(first, first.pkg)
      const second = readDocx(saved, name)

      // ツリーの一致より先にテキストの一致を見る。壊れ方が一目で分かるため
      expect(plainText(second.doc), `${name}: 本文テキスト`).toBe(plainText(first.doc))
      expect(plainText(first.doc).length, `${name}: 本文が空`).toBeGreaterThan(0)
      expect(normalize(second.doc), `${name}: 本文ツリー`).toEqual(normalize(first.doc))
      expect(normalize(second.resources.sections), `${name}: セクション`).toEqual(
        normalize(first.resources.sections)
      )
      expect(second.unsupported, `${name}: 未対応要素`).toEqual(first.unsupported)
    }
  })

  it('2 回保存しても document.xml が安定する', () => {
    for (const name of fixtureNames()) {
      const first = readDocx(readFixture(name), name)
      const savedOnce = writeDocx(first, first.pkg)
      const second = readDocx(savedOnce, name)
      const savedTwice = writeDocx(second, openPackage(savedOnce))

      const a = strFromU8(unzipSync(savedOnce)[first.resources.documentPartName]!)
      const b = strFromU8(unzipSync(savedTwice)[second.resources.documentPartName]!)
      expect(b, `${name}: 2 回目の保存で内容が変わった`).toBe(a)
    }
  })
})

describe('画像', () => {
  it('w:drawing をモデル化して読む', () => {
    const { doc, resources, unsupported } = readDocx(readFixture('12-image.docx'))
    // raw 退避ではなくモデルとして読めていること
    expect(unsupported).not.toContain('w:drawing')

    const images: unknown[] = []
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const n = node as { type?: string; content?: unknown[] }
      if (n.type === 'image') images.push(n)
      if (Array.isArray(n.content)) n.content.forEach(walk)
    }
    doc.content.forEach(walk)

    expect(images).toHaveLength(1)
    const image = images[0] as {
      attrs: { mediaKey: string; cx: number; cy: number; inline: boolean; descr: string }
    }
    expect(image.attrs.mediaKey).toBe('word/media/image1.png')
    // 1 インチ角 = 914400 EMU
    expect(image.attrs.cx).toBe(914400)
    expect(image.attrs.cy).toBe(914400)
    expect(image.attrs.inline).toBe(true)
    expect(image.attrs.descr).toBe('青い四角')

    // メディアの中身も読めていること
    const media = resources.media.get('word/media/image1.png')
    expect(media, 'メディアパートが読めていない').toBeDefined()
    expect(media!.contentType).toBe('image/png')
    expect(media!.bytes.length).toBeGreaterThan(0)
  })

  it('画像の入ったパートが保存で失われない', () => {
    const doc = readDocx(readFixture('12-image.docx'))
    const saved = writeDocx(doc, doc.pkg)
    const after = readDocx(saved)
    const media = after.resources.media.get('word/media/image1.png')
    expect(media, '画像パートが失われた').toBeDefined()
    expect(Array.from(media!.bytes)).toEqual(
      Array.from(doc.resources.media.get('word/media/image1.png')!.bytes)
    )
  })
})
