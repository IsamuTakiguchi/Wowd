import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import { openPackage, type DocxPackage } from '@core/docx/package'
import { validatePackage, errorsOnly, formatProblems } from '@core/docx/validate'
import { fixtureNames, readFixture } from './helpers'

/**
 * パッケージ整合性。
 *
 * XSD は各パートを単体でしか見ない。パート単体としては正しくても、
 * パッケージ全体の参照グラフが閉じていなければ Word は開けない。
 *
 * この種類の不具合は往復テストでも検出できない。参照が切れていても、
 * 読み直したモデルは「参照が切れた状態」として同じに見えるため。
 */

/** 元のフィクスチャと、Wowd が保存し直したものの両方を見る */
function packagesFor(name: string): { label: string; pkg: DocxPackage }[] {
  const source = readFixture(name)
  const model = readDocx(source, name)
  const saved = writeDocx(model, model.pkg, { headersChanged: true, commentsChanged: true })
  return [
    { label: `${name} (元)`, pkg: openPackage(source) },
    { label: `${name} (保存後)`, pkg: openPackage(saved) }
  ]
}

describe('パッケージ整合性', () => {
  it('全フィクスチャの元ファイルと保存結果で参照が閉じている', () => {
    for (const name of fixtureNames()) {
      for (const { label, pkg } of packagesFor(name)) {
        const problems = errorsOnly(validatePackage(pkg))
        expect(problems, `${label}\n${formatProblems(problems)}`).toEqual([])
      }
    }
  })

  it('改訂 ID の重複を警告として報告する', () => {
    // 重複は Word でも致命ではないが、承諾・取り消しの単位が混ざる
    const problems = validatePackage(packageWith({
      'word/document.xml':
        '<w:document><w:body>' +
        '<w:ins w:id="5"><w:r><w:t>あ</w:t></w:r></w:ins>' +
        '<w:del w:id="5"><w:r><w:delText>い</w:delText></w:r></w:del>' +
        '</w:body></w:document>'
    }))
    expect(problems.some((p) => p.severity === 'warning' && /w:id が重複/.test(p.message))).toBe(
      true
    )
  })
})

/** 最小限の .docx を組み立てる。壊し方を 1 か所だけ変えて検査を確かめる用 */
function packageWith(overrides: Record<string, string>): DocxPackage {
  const base: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/document.xml': '<w:document><w:body><w:p/></w:body></w:document>',
    'word/_rels/document.xml.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
  }
  const merged = { ...base, ...overrides }
  const files: Record<string, Uint8Array> = {}
  for (const [name, xml] of Object.entries(merged)) files[name] = strToU8(xml)
  return openPackage(zipSync(files))
}

describe('壊れたパッケージの検出', () => {
  it('Content_Types に指定の無いパートを見つける', () => {
    const pkg = packageWith({ 'word/unknown.bin': 'x' })
    const problems = errorsOnly(validatePackage(pkg))
    expect(problems.some((p) => p.part === 'word/unknown.bin')).toBe(true)
  })

  it('実在しないパートを指す関係を見つける', () => {
    const pkg = packageWith({
      'word/_rels/document.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.png"/>' +
        '</Relationships>'
    })
    const problems = errorsOnly(validatePackage(pkg))
    expect(problems.some((p) => /Target が実在しません/.test(p.message))).toBe(true)
  })

  it('外部リンクは実在を求めない', () => {
    // TargetMode="External" はパッケージの外を指すので、あって当然
    const pkg = packageWith({
      'word/_rels/document.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/>' +
        '</Relationships>'
    })
    expect(errorsOnly(validatePackage(pkg))).toEqual([])
  })

  it('rels に無い r:embed を見つける', () => {
    // 画像を挿入したのに関係を張り忘れた状態。Word では画像が空欄になる
    const pkg = packageWith({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:drawing><a:blip r:embed="rId99"/></w:drawing></w:r></w:p></w:body></w:document>'
    })
    const problems = errorsOnly(validatePackage(pkg))
    expect(problems.some((p) => /rId99 を参照/.test(p.message))).toBe(true)
  })

  it('対応の無い commentRangeStart を見つける', () => {
    const pkg = packageWith({
      'word/document.xml':
        '<w:document><w:body><w:p><w:commentRangeStart w:id="1"/><w:r><w:t>あ</w:t></w:r></w:p></w:body></w:document>'
    })
    const problems = errorsOnly(validatePackage(pkg))
    expect(problems.some((p) => /commentRangeEnd がありません/.test(p.message))).toBe(true)
  })

  it('comments.xml に無いコメントへの参照を見つける', () => {
    const pkg = packageWith({
      'word/document.xml':
        '<w:document><w:body><w:p>' +
        '<w:commentRangeStart w:id="3"/><w:r><w:t>あ</w:t></w:r><w:commentRangeEnd w:id="3"/>' +
        '</w:p></w:body></w:document>'
    })
    const problems = errorsOnly(validatePackage(pkg))
    expect(problems.some((p) => /コメント 3 を参照/.test(p.message))).toBe(true)
  })

  it('対応の無い bookmarkStart を見つける', () => {
    const pkg = packageWith({
      'word/document.xml':
        '<w:document><w:body><w:p><w:bookmarkStart w:id="1" w:name="_Toc1"/></w:p></w:body></w:document>'
    })
    const problems = errorsOnly(validatePackage(pkg))
    expect(problems.some((p) => /bookmarkEnd がありません/.test(p.message))).toBe(true)
  })

  it('関係 ID の重複を見つける', () => {
    const pkg = packageWith({
      'word/_rels/document.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="document.xml"/>' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="document.xml"/>' +
        '</Relationships>'
    })
    const problems = errorsOnly(validatePackage(pkg))
    expect(problems.some((p) => /関係 ID が重複/.test(p.message))).toBe(true)
  })

  it('正しいパッケージには何も報告しない', () => {
    expect(errorsOnly(validatePackage(packageWith({})))).toEqual([])
  })
})
