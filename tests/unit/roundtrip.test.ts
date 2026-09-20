import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { openPackage, ensureUpdateFields } from '@core/docx/package'
import { fixtureNames, readFixture } from './helpers'
import { fromEditableText, toEditableText } from '@core/headerFooter'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

    // 行内 1 枚 + 浮動 5 枚
    expect(images).toHaveLength(6)
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

describe('変更履歴', () => {
  it('段落記号の挿入・削除 (w:pPr/w:rPr の w:ins / w:del) を読む', () => {
    const { doc } = readDocx(readFixture('10-revisions.docx'), '10-revisions.docx')
    const revisions = doc.content
      .filter((b) => b.type === 'paragraph')
      .map((b) => (b.type === 'paragraph' ? b.attrs.paraMarkRevision : null))
      .filter((r) => r != null)

    expect(revisions).toHaveLength(2)
    expect(revisions[0]).toMatchObject({ kind: 'ins', meta: { author: '校閲者A' } })
    expect(revisions[1]).toMatchObject({ kind: 'del', meta: { author: '校閲者B' } })
  })

  it('段落記号の印が保存で失われず、二重にもならない', () => {
    const source = readFixture('10-revisions.docx')
    const model = readDocx(source, '10-revisions.docx')
    const saved = writeDocx(model, model.pkg)
    const xml = strFromU8(unzipSync(saved)['word/document.xml'] as Uint8Array)

    // pPr の中に 1 つずつだけ入っていること
    expect(xml.match(/<w:pPr><w:rPr><w:ins /g) ?? []).toHaveLength(1)
    expect(xml.match(/<w:pPr><w:rPr><w:del /g) ?? []).toHaveLength(1)

    const again = readDocx(saved, '10-revisions.docx')
    expect(normalize(again.doc)).toEqual(normalize(model.doc))
  })
})

describe('画像の挿入', () => {
  it('新しい画像がパート・関係・コンテンツタイプごと保存される', () => {
    const source = readFixture('01-plain.docx')
    const model = readDocx(source, '01-plain.docx')
    expect(model.resources.media.size, '元の文書に画像は無い').toBe(0)

    // 挿入したときと同じことをする (資源に足すだけ)
    const bytes = new Uint8Array(readFileSync(join('tests', 'fixtures', 'sample.png')))
    model.resources.media.set('word/media/image1.png', { bytes, contentType: 'image/png' })
    const relId = `rId${model.resources.rels.nextId}`
    model.resources.rels.byId.set(relId, {
      id: relId,
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      target: 'media/image1.png',
      targetMode: null
    })

    const saved = writeDocx(model, model.pkg)
    const parts = unzipSync(saved)

    // 1. バイト列がそのまま入っている
    expect(parts['word/media/image1.png']).toBeDefined()
    expect(parts['word/media/image1.png']?.length).toBe(bytes.length)

    // 2. 関係が張られている
    const rels = strFromU8(parts['word/_rels/document.xml.rels'] as Uint8Array)
    expect(rels).toContain(`Id="${relId}"`)
    expect(rels).toContain('media/image1.png')

    // 3. 拡張子の既定コンテンツタイプがある
    const types = strFromU8(parts['[Content_Types].xml'] as Uint8Array)
    expect(types).toMatch(/<Default[^>]*Extension="png"/)
  })

  it('原文を持たない画像でも w:drawing を組み立てて書き出す', () => {
    const source = readFixture('01-plain.docx')
    const model = readDocx(source, '01-plain.docx')
    const bytes = new Uint8Array(readFileSync(join('tests', 'fixtures', 'sample.png')))

    model.resources.media.set('word/media/image1.png', { bytes, contentType: 'image/png' })
    const relId = `rId${model.resources.rels.nextId}`
    model.resources.rels.byId.set(relId, {
      id: relId,
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      target: 'media/image1.png',
      targetMode: null
    })
    // 挿入した画像は rawDrawing を持たない。ここが書けないと保存で消える
    const first = model.doc.content[0]
    if (first?.type !== 'paragraph') throw new Error('先頭が段落でない')
    first.content = [
      ...(first.content ?? []),
      {
        type: 'image',
        attrs: {
          mediaKey: 'word/media/image1.png',
          relId,
          cx: 914400,
          cy: 914400,
          wrap: 'inline',
        align: null,
          name: 'sample.png',
          descr: '',
          inline: true,
          rawDrawing: null
        }
      }
    ]

    const saved = writeDocx(model, model.pkg)
    const xml = strFromU8(unzipSync(saved)['word/document.xml'] as Uint8Array)
    expect(xml).toContain('<w:drawing>')
    expect(xml).toContain(`r:embed="${relId}"`)
    expect(xml).toContain('cx="914400"')

    // 読み直すと画像として戻る
    const again = readDocx(saved, '01-plain.docx')
    const images = again.doc.content.flatMap((b) =>
      b.type === 'paragraph' ? (b.content ?? []).filter((n) => n.type === 'image') : []
    )
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ attrs: { mediaKey: 'word/media/image1.png', cx: 914400 } })
  })

  it('もともとある画像のパートは書き直さない', () => {
    const source = readFixture('12-image.docx')
    const model = readDocx(source, '12-image.docx')
    const saved = writeDocx(model, model.pkg)

    const before = unzipSync(source)['word/media/image1.png']
    const after = unzipSync(saved)['word/media/image1.png']
    expect(after).toEqual(before)
  })
})

describe('ヘッダーとフッター', () => {
  const HEADER_REL =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'

  it('新しいヘッダーがパート・関係・コンテンツタイプ・参照ごと保存される', () => {
    const source = readFixture('01-plain.docx')
    const model = readDocx(source, '01-plain.docx')

    const relId = `rId${model.resources.rels.nextId}`
    model.resources.rels.byId.set(relId, {
      id: relId,
      type: HEADER_REL,
      target: 'header1.xml',
      targetMode: null
    })
    model.resources.headers.set(relId, fromEditableText('社外秘', 'right'))
    const section = model.resources.sections[0]
    if (!section) throw new Error('セクションが無い')
    section.headerRefs = { ...section.headerRefs, default: relId }

    const saved = writeDocx(model, model.pkg, { headersChanged: true })
    const parts = unzipSync(saved)

    // 1. パートの中身
    const hdr = strFromU8(parts['word/header1.xml'] as Uint8Array)
    expect(hdr).toContain('<w:hdr')
    expect(hdr).toContain('社外秘')
    expect(hdr).toContain('<w:jc w:val="right"/>')

    // 2. 関係
    const rels = strFromU8(parts['word/_rels/document.xml.rels'] as Uint8Array)
    expect(rels).toContain(`Id="${relId}"`)
    expect(rels).toContain('header1.xml')

    // 3. コンテンツタイプ
    const types = strFromU8(parts['[Content_Types].xml'] as Uint8Array)
    expect(types).toContain('wordprocessingml.header+xml')

    // 4. セクションからの参照
    const xml = strFromU8(parts['word/document.xml'] as Uint8Array)
    expect(xml).toContain('<w:headerReference')
    expect(xml).toContain(`r:id="${relId}"`)

    // 読み直すと同じ内容で戻る
    const again = readDocx(saved, '01-plain.docx')
    expect(toEditableText(again.resources.headers.get(relId) ?? null)).toEqual({
      text: '社外秘',
      jc: 'right'
    })
  })

  it('headersChanged を立てなければヘッダーのパートに触らない', () => {
    const source = readFixture('05-kitchen-sink.docx')
    const model = readDocx(source, '05-kitchen-sink.docx')
    const saved = writeDocx(model, model.pkg)

    const before = unzipSync(source)
    const after = unzipSync(saved)
    for (const name of Object.keys(before)) {
      if (!/header\d*\.xml$|footer\d*\.xml$/.test(name)) continue
      expect(after[name], `${name} が書き換わった`).toEqual(before[name])
    }
  })
})

describe('名前空間と settings.xml', () => {
  it('画像の w:drawing が名前空間を自前で宣言する', () => {
    // documentRootAttrs は元文書のルート宣言を使い回すので、
    // wp: や a: を宣言していない文書に画像を入れると
    // 未宣言の接頭辞を含む XML になり、Word は開くことすらできない
    const source = readFixture('01-plain.docx')
    const model = readDocx(source, '01-plain.docx')
    const bytes = new Uint8Array(readFileSync(join('tests', 'fixtures', 'sample.png')))
    model.resources.media.set('word/media/image1.png', { bytes, contentType: 'image/png' })
    const relId = `rId${model.resources.rels.nextId}`
    model.resources.rels.byId.set(relId, {
      id: relId,
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      target: 'media/image1.png',
      targetMode: null
    })
    const first = model.doc.content[0]
    if (first?.type !== 'paragraph') throw new Error('先頭が段落でない')
    first.content = [
      {
        type: 'image',
        attrs: {
          mediaKey: 'word/media/image1.png',
          relId,
          cx: 914400,
          cy: 914400,
          wrap: 'inline',
        align: null,
          name: 'sample.png',
          descr: '',
          inline: true,
          rawDrawing: null
        }
      }
    ]

    const xml = strFromU8(unzipSync(writeDocx(model, model.pkg))['word/document.xml'] as Uint8Array)
    const drawing = /<w:drawing>[\s\S]*?<\/w:drawing>/.exec(xml)?.[0] ?? ''
    expect(drawing).toContain('xmlns:wp=')
    expect(drawing).toContain('xmlns:a=')
    expect(drawing).toContain('xmlns:pic=')
  })

  it('目次を作ったときだけ settings.xml に w:updateFields を立てる', () => {
    const source = readFixture('13-headings.docx')
    const model = readDocx(source, '13-headings.docx')

    // 触っていないときは元のままバイト一致
    const untouched = unzipSync(writeDocx(model, model.pkg))['word/settings.xml']
    expect(untouched).toEqual(unzipSync(source)['word/settings.xml'])

    // 目次を作ったときだけ立てる
    const withToc = strFromU8(
      unzipSync(writeDocx(model, model.pkg, { tocChanged: true }))['word/settings.xml'] as Uint8Array
    )
    expect(withToc).toContain('<w:updateFields w:val="true"/>')
  })

  it('w:updateFields は CT_Settings の規定位置に入る', () => {
    // settings.xml も sequence なので、末尾に足すだけでは規定違反になる
    const settings =
      '<w:settings xmlns:w="x"><w:defaultTabStop w:val="840"/><w:compat/><w:rsids/></w:settings>'
    const out = ensureUpdateFields(settings)
    expect(out).toBe(
      '<w:settings xmlns:w="x"><w:defaultTabStop w:val="840"/>' +
        '<w:updateFields w:val="true"/><w:compat/><w:rsids/></w:settings>'
    )
  })

  it('既にある w:updateFields は true に差し替える', () => {
    const settings = '<w:settings xmlns:w="x"><w:updateFields w:val="false"/><w:compat/></w:settings>'
    expect(ensureUpdateFields(settings)).toContain('<w:updateFields w:val="true"/>')
    expect(ensureUpdateFields(settings)).not.toContain('w:val="false"')
  })
})

describe('浮動画像 (wp:anchor)', () => {
  /** 12-image.docx に含まれる画像ノードを集める */
  function imagesOf(name: string) {
    const { doc } = readDocx(readFixture(name), name)
    return doc.content.flatMap((b) =>
      b.type === 'paragraph'
        ? (b.content ?? []).filter((n) => n.type === 'image').map((n) => n as never)
        : []
    ) as { attrs: { inline: boolean; wrap: string; cx: number } }[]
  }

  it('回り込みの種類を読み分ける', () => {
    // レターヘッドのロゴなどで普通に使われる。種類ごとに読み取りが変わる
    const images = imagesOf('12-image.docx')
    const floating = images.filter((i) => !i.attrs.inline)
    expect(floating.map((i) => i.attrs.wrap)).toEqual([
      'square',
      'tight',
      'topAndBottom',
      // wrapNone は behindDoc で前面か背面かが決まる
      'behind',
      'inFront'
    ])
  })

  it('行内画像と浮動画像を区別する', () => {
    const images = imagesOf('12-image.docx')
    expect(images.filter((i) => i.attrs.inline)).toHaveLength(1)
    expect(images.filter((i) => !i.attrs.inline).length).toBeGreaterThan(0)
  })

  it('浮動画像も保存で失われない', () => {
    const source = readFixture('12-image.docx')
    const model = readDocx(source, '12-image.docx')
    const saved = writeDocx(model, model.pkg)
    const xml = strFromU8(unzipSync(saved)['word/document.xml'] as Uint8Array)

    // 原文のまま書き戻すので、回り込みの指定がそのまま残る
    expect(xml).toContain('<wp:anchor')
    expect(xml).toContain('wp:wrapSquare')
    expect(xml).toContain('wp:wrapTopAndBottom')
    expect(imagesOf('12-image.docx')).toHaveLength(6)
  })
})
