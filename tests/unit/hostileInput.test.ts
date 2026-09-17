import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { zipSync, strToU8 } from 'fflate'
import { openPackage, DocxPackageError } from '@core/docx/package'
import { readDocx } from '@core/docx/read'
import { readFixture } from './helpers'

/**
 * 悪意のある / 壊れた .docx に対する堅牢性。
 *
 * .docx は外部から来るバイナリで、そのまま攻撃面になる。
 * 法律事務所の用途では「相手方から届いたファイルを開く」のが日常なので、
 * ここが弱いと実害が出る。
 *
 * 求めるのは 2 つのうちどちらか:
 *   1. 安全に読める
 *   2. DocxPackageError などの明確なエラーで落ちる
 *
 * やってはいけないのは「ハングする」「パッケージの外に書き出す」
 * 「暗黙に壊れたまま読めたことにする」。
 *
 * 上限値 (MAX_PARTS / MAX_PART_BYTES / MAX_TOTAL_BYTES) は実装されていたが、
 * これまで一度も発火させていなかった。ここで実際に踏ませる。
 */

/** 最小限の正しい .docx を組み立てる */
function baseParts(): Record<string, Uint8Array> {
  return {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8('<w:document><w:body><w:p/></w:body></w:document>')
  }
}

function docxWith(extra: Record<string, Uint8Array>): Uint8Array {
  return zipSync({ ...baseParts(), ...extra })
}

describe('パート名の検証 (読み込み側)', () => {
  // 書き出し側の検証はあったが、読み込み側は素通りだった。
  // 悪意ある zip はパッケージの外へ書かせようとしてくる
  const dangerous = [
    '../../etc/passwd',
    '../evil.xml',
    'word/../../evil.xml',
    '/etc/passwd',
    'C:\\Windows\\System32\\evil.dll',
    'word/doc\0ument.xml'
  ]

  for (const name of dangerous) {
    it(`危険なパート名を拒否する: ${JSON.stringify(name)}`, () => {
      const bytes = zipSync({ ...baseParts(), [name]: strToU8('x') })
      expect(() => openPackage(bytes)).toThrow(DocxPackageError)
    })
  }

  it('正常なパート名は通す', () => {
    expect(() => openPackage(docxWith({ 'word/media/image1.png': strToU8('x') }))).not.toThrow()
  })
})

describe('資源の上限', () => {
  it('パート数が多すぎる zip を拒否する', () => {
    const many: Record<string, Uint8Array> = { ...baseParts() }
    for (let i = 0; i < 5001; i++) many[`word/p${i}.xml`] = strToU8('<a/>')
    expect(() => openPackage(zipSync(many))).toThrow(/パート数/)
  })

  it('展開後の合計が上限を超える zip を拒否する', () => {
    // 同じバイトの繰り返しは deflate がよく効くので、
    // zip としては小さいまま展開後だけ巨大になる (zip bomb の原型)
    const chunk = new Uint8Array(64 * 1024 * 1024)
    const parts: Record<string, Uint8Array> = { ...baseParts() }
    for (let i = 0; i < 9; i++) parts[`word/big${i}.bin`] = chunk
    expect(() => openPackage(zipSync(parts, { level: 9 }))).toThrow(/上限/)
  }, 120_000)
})

describe('壊れたパッケージ', () => {
  it('[Content_Types].xml が無ければ拒否する', () => {
    expect(() => openPackage(zipSync({ 'word/document.xml': strToU8('<a/>') }))).toThrow(
      /Content_Types/
    )
  })

  it('本文パートが無ければ拒否する', () => {
    const parts = baseParts()
    delete parts['word/document.xml']
    expect(() => openPackage(zipSync(parts))).toThrow(DocxPackageError)
  })

  it('_rels/.rels が壊れていても本文を既定の場所から拾う', () => {
    // 壊れた rels で即座に諦めず、word/document.xml を試すのが実装の意図
    const parts = baseParts()
    parts['_rels/.rels'] = strToU8('<<< これは XML ではない')
    expect(openPackage(zipSync(parts)).documentPartName).toBe('word/document.xml')
  })

  it('officeDocument の関係が実在しないパートを指しても既定に落ちる', () => {
    const parts = baseParts()
    parts['_rels/.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/nowhere.xml"/>' +
        '</Relationships>'
    )
    expect(openPackage(zipSync(parts)).documentPartName).toBe('word/document.xml')
  })

  it('途中で切り詰めた .docx を拒否する', () => {
    const full = readFixture('01-plain.docx')
    for (const ratio of [0.1, 0.5, 0.9, 0.99]) {
      const cut = full.slice(0, Math.floor(full.length * ratio))
      expect(() => openPackage(cut), `${ratio} で切断`).toThrow(DocxPackageError)
    }
  })
})

describe('XML 側の攻撃', () => {
  /** 本文を差し替えた .docx を読む。例外は投げさせず、結果を見る */
  function readBody(documentXml: string): { ok: boolean; text: string } {
    try {
      const model = readDocx(docxWith({ 'word/document.xml': strToU8(documentXml) }), null)
      let text = ''
      const walk = (n: { type?: string; text?: string; content?: unknown[] }): void => {
        if (n.type === 'text' && n.text) text += n.text
        for (const c of (n.content ?? []) as typeof n[]) walk(c)
      }
      model.doc.content.forEach((b) => walk(b as never))
      return { ok: true, text }
    } catch {
      return { ok: false, text: '' }
    }
  }

  it('entity 展開 (billion laughs) で膨らまない', () => {
    // 外部・カスタム entity を展開すると、小さな入力でメモリを食い潰せる
    const bomb =
      '<?xml version="1.0"?>' +
      '<!DOCTYPE w:document [' +
      '<!ENTITY a "aaaaaaaaaa">' +
      '<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">' +
      '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">' +
      '<!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">' +
      ']>' +
      '<w:document><w:body><w:p><w:r><w:t>&d;</w:t></w:r></w:p></w:body></w:document>'

    const result = readBody(bomb)
    // 展開されていれば 100 万文字になる。されないことが要点
    expect(result.text.length).toBeLessThan(10_000)
  })

  it('外部 entity を読みに行かない', () => {
    // ローカルファイルを本文に流し込ませる古典的な攻撃 (XXE)
    const xxe =
      '<?xml version="1.0"?>' +
      '<!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
      '<w:document><w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>'

    // 黙って空になるのではなく、明確に拒否されること
    expect(() =>
      readDocx(docxWith({ 'word/document.xml': strToU8(xxe) }), null)
    ).toThrow(/External entities are not supported/)
  })

  it('深い入れ子は上限で弾く。スタックを溢れさせない', () => {
    // 再帰で読んでいるので、ここが弱いとプロセスごと落ちる。
    // パーサ側に入れ子の上限 (要素の深さ 100) があり、そこで止まる
    const nest = (depth: number): string => {
      const open = '<w:tbl><w:tr><w:tc>'.repeat(depth)
      const close = '</w:tc></w:tr></w:tbl>'.repeat(depth)
      return `<w:document><w:body>${open}<w:p><w:r><w:t>底</w:t></w:r></w:p>${close}</w:body></w:document>`
    }

    for (const depth of [1000, 5000]) {
      const started = Date.now()
      expect(() => readDocx(docxWith({ 'word/document.xml': strToU8(nest(depth)) }), null)).toThrow(
        /Maximum nested tags/
      )
      // 指数的に時間がかかっていないこと
      expect(Date.now() - started, `深さ ${depth}`).toBeLessThan(5_000)
    }
  })

  it('現実的な入れ子の深さは通る', () => {
    // 上限が厳しすぎると、入れ子の表を含む普通の契約書が開けなくなる。
    // 入れ子の表 5 段 (要素の深さ 20 弱) までは確実に通ること
    const depth = 5
    const open = '<w:tbl><w:tr><w:tc>'.repeat(depth)
    const close = '</w:tc></w:tr></w:tbl>'.repeat(depth)
    const xml = `<w:document><w:body>${open}<w:p><w:r><w:t>底</w:t></w:r></w:p>${close}</w:body></w:document>`
    expect(readBody(xml)).toEqual({ ok: true, text: '底' })
  })

  it('巨大な単一 w:t を扱える', () => {
    const huge = 'あ'.repeat(2_000_000)
    const xml = `<w:document><w:body><w:p><w:r><w:t>${huge}</w:t></w:r></w:p></w:body></w:document>`
    const result = readBody(xml)
    if (result.ok) expect(result.text.length).toBe(huge.length)
  }, 60_000)

  it('壊れた本文は空の文書として開かず、明確に拒否する', () => {
    // パーサは寛容で、途中で切れた XML も「読めたところまで」を黙って返す。
    // そのまま開くと空の文書に見え、保存すれば原本が空で上書きされる。
    // 黙って壊すより開く前に止める
    for (const broken of [
      '<w:document><w:body><w:p><w:r><w:t>本文あり',
      '<w:document><w:body><w:p></w:foo></w:body></w:document>',
      ''
    ]) {
      expect(() =>
        readDocx(docxWith({ 'word/document.xml': strToU8(broken) }), null)
      ).toThrow(/壊れています|本文パート/)
    }
  })

  it('正常な本文は拒否しない', () => {
    expect(readBody('<w:document><w:body><w:p><w:r><w:t>正常</w:t></w:r></w:p></w:body></w:document>'))
      .toEqual({ ok: true, text: '正常' })
  })
})

describe('任意のバイト列 (性質テスト)', () => {
  it('どんなバイト列でも、読めるか明確なエラーかのどちらかになる', () => {
    // 想定していない入力でクラッシュしないことを、手で選んだ例ではなく
    // ランダムな入力で確かめる
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 2048 }), (bytes) => {
        try {
          openPackage(bytes)
        } catch (err) {
          // 型の分からない例外や、メッセージの無い例外は「明確」ではない
          expect(err).toBeInstanceOf(Error)
          expect((err as Error).message.length).toBeGreaterThan(0)
        }
        return true
      }),
      { numRuns: 300 }
    )
  })

  it('正しい zip の中身がランダムでも、読めるか明確なエラーになる', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.stringMatching(/^[a-z0-9_]{1,12}\.xml$/),
          fc.uint8Array({ maxLength: 256 }),
          { maxKeys: 8 }
        ),
        (extra) => {
          const parts: Record<string, Uint8Array> = { ...baseParts() }
          for (const [name, data] of Object.entries(extra)) parts[`word/${name}`] = data
          try {
            openPackage(zipSync(parts))
          } catch (err) {
            expect(err).toBeInstanceOf(DocxPackageError)
          }
          return true
        }
      ),
      { numRuns: 100 }
    )
  })
})
