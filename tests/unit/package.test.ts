import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import {
  openPackage,
  savePackage,
  resolveRelTarget,
  relsPartNameFor,
  ensureDefaultContentType,
  DocxPackageError,
  CONTENT_TYPES_PART
} from '@core/docx/package'
import { fixtureNames, readFixture } from './helpers'

describe('openPackage', () => {
  it('全フィクスチャを開けて本文パートを解決する', () => {
    for (const name of fixtureNames()) {
      const pkg = openPackage(readFixture(name))
      expect(pkg.parts.has(CONTENT_TYPES_PART), name).toBe(true)
      expect(pkg.parts.has(pkg.documentPartName), name).toBe(true)
      expect(pkg.documentPartName, name).toMatch(/document\.xml$/)
    }
  })

  it('.docx でないバイト列は DocxPackageError を投げる', () => {
    expect(() => openPackage(new Uint8Array([1, 2, 3, 4]))).toThrow(DocxPackageError)
  })

  it('[Content_Types].xml が無い zip は拒否する', () => {
    const { zipSync, strToU8 } = require('fflate') as typeof import('fflate')
    const bogus = zipSync({ 'hello.txt': strToU8('hi') })
    expect(() => openPackage(bogus)).toThrow(/Content_Types/)
  })
})

/**
 * Phase 2 の最重要ゲート。
 * document.xml の解析を 1 行も書く前に、これが全フィクスチャで通ることを確かめる。
 *
 * zip コンテナのバイト列は deflate 実装に依存するので元ファイルとは一致しない。
 * 保証すべきは「各パートの中身が 1 バイトも変わらないこと」。
 */
describe('savePackage — パッケージ保存型ラウンドトリップ', () => {
  it('無変更の保存で全パートの中身がバイト一致する', () => {
    for (const name of fixtureNames()) {
      const original = readFixture(name)
      const pkg = openPackage(original)
      const saved = savePackage(pkg)

      const before = unzipSync(original)
      const after = unzipSync(saved)

      const beforeNames = Object.keys(before)
        .filter((n) => !n.endsWith('/'))
        .sort()
      const afterNames = Object.keys(after).sort()
      expect(afterNames, `${name}: パート一覧`).toEqual(beforeNames)

      for (const part of beforeNames) {
        expect(Array.from(after[part]!), `${name}: ${part} の中身`).toEqual(
          Array.from(before[part]!)
        )
      }
    }
  })

  it('差し替えたパートだけが変わり、他は元のまま残る', () => {
    const pkg = openPackage(readFixture('01-plain.docx'))
    const replaced = '<?xml version="1.0"?><w:document xmlns:w="x"/>'
    const saved = savePackage(pkg, {
      overrides: new Map([[pkg.documentPartName, replaced]])
    })
    const after = unzipSync(saved)
    const original = unzipSync(readFixture('01-plain.docx'))

    expect(new TextDecoder().decode(after[pkg.documentPartName]!)).toBe(replaced)
    for (const part of Object.keys(original).filter((n) => !n.endsWith('/'))) {
      if (part === pkg.documentPartName) continue
      expect(Array.from(after[part]!), part).toEqual(Array.from(original[part]!))
    }
  })

  it('null を渡したパートは削除される', () => {
    const pkg = openPackage(readFixture('01-plain.docx'))
    const target = [...pkg.parts.keys()].find((k) => k.endsWith('fontTable.xml'))
    if (!target) return
    const saved = savePackage(pkg, { overrides: new Map([[target, null]]) })
    expect(Object.keys(unzipSync(saved))).not.toContain(target)
  })

  it('[Content_Types].xml を消そうとすると拒否する', () => {
    const pkg = openPackage(readFixture('01-plain.docx'))
    expect(() =>
      savePackage(pkg, { overrides: new Map([[CONTENT_TYPES_PART, null]]) })
    ).toThrow(DocxPackageError)
  })

  it('パストラバーサルを含むパート名の追加を拒否する', () => {
    const pkg = openPackage(readFixture('01-plain.docx'))
    expect(() =>
      savePackage(pkg, { overrides: new Map([['../evil.xml', 'x']]) })
    ).toThrow(/親ディレクトリ/)
  })
})

describe('リレーション解決', () => {
  it('相対ターゲットをパート名に解決する', () => {
    expect(resolveRelTarget('word/document.xml', 'media/image1.png')).toBe('word/media/image1.png')
    expect(resolveRelTarget('word/document.xml', '../customXml/item1.xml')).toBe(
      'customXml/item1.xml'
    )
    expect(resolveRelTarget('word/document.xml', '/word/styles.xml')).toBe('word/styles.xml')
    expect(resolveRelTarget('word/document.xml', './theme/theme1.xml')).toBe('word/theme/theme1.xml')
  })

  it('.rels のパート名を導出する', () => {
    expect(relsPartNameFor('word/document.xml')).toBe('word/_rels/document.xml.rels')
    expect(relsPartNameFor('word/header1.xml')).toBe('word/_rels/header1.xml.rels')
  })
})

describe('ensureDefaultContentType', () => {
  it('未登録の拡張子を追加する', () => {
    const xml = '<?xml version="1.0"?><Types xmlns="x"><Default Extension="xml" ContentType="a"/></Types>'
    const out = ensureDefaultContentType(xml, 'png', 'image/png')
    expect(out).toContain('Extension="png"')
  })

  it('登録済みなら何も変えない', () => {
    const xml = '<Types><Default Extension="png" ContentType="image/png"/></Types>'
    expect(ensureDefaultContentType(xml, 'png', 'image/png')).toBe(xml)
  })
})
