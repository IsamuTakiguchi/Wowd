/**
 * OOXML を直接書いてフィクスチャを作る。
 *
 * docx@9.7.1 は w:ruby を一切サポートしておらず、コメントや変更履歴を
 * 含むファイルも作りにくい。そこで、生成済みの空テンプレートを土台にして
 * document.xml だけを差し替える。
 *
 * Word が納得するパッケージ骨格 (theme / styles / settings / fontTable) を
 * 保ったまま、任意の機能を含むファイルを作れる。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openPackage, savePackage, ensureDefaultContentType } from '../src/core/docx/package'

const OUT_DIR = join(process.cwd(), 'tests', 'fixtures', 'docx')
const TEMPLATE_DIR = join(process.cwd(), 'resources', 'templates')
const SAMPLE_PNG = join(process.cwd(), 'tests', 'fixtures', 'sample.png')

/** テンプレートの document.xml から名前空間宣言を借りる */
function documentShell(body: string, templateXml: string): string {
  const attrs = /<w:document\b([^>]*)>/.exec(templateXml)?.[1] ?? ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document${attrs}><w:body>${body}</w:body></w:document>`
}

interface ExtraParts {
  /** 追加するパート。画像などのメディア */
  parts?: Map<string, Uint8Array>
  /** 本文の rels に足す関係 */
  rels?: { id: string; type: string; target: string }[]
  /** [Content_Types].xml に足す拡張子の既定 */
  contentTypes?: { extension: string; contentType: string }[]
}

function emit(name: string, template: string, body: string, extra: ExtraParts = {}): void {
  const bytes = new Uint8Array(readFileSync(join(TEMPLATE_DIR, template)))
  const pkg = openPackage(bytes)
  const original = new TextDecoder().decode(pkg.parts.get(pkg.documentPartName)!)
  const overrides = new Map<string, Uint8Array | string | null>([
    [pkg.documentPartName, documentShell(body, original)]
  ])

  for (const [part, data] of extra.parts ?? []) overrides.set(part, data)

  if (extra.rels?.length) {
    const relsPart = 'word/_rels/document.xml.rels'
    const relsXml = new TextDecoder().decode(pkg.parts.get(relsPart)!)
    const added = extra.rels
      .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`)
      .join('')
    overrides.set(relsPart, relsXml.replace('</Relationships>', `${added}</Relationships>`))
  }

  if (extra.contentTypes?.length) {
    let types = new TextDecoder().decode(pkg.parts.get('[Content_Types].xml')!)
    for (const ct of extra.contentTypes) {
      types = ensureDefaultContentType(types, ct.extension, ct.contentType)
    }
    overrides.set('[Content_Types].xml', types)
  }

  const out = savePackage(pkg, { overrides })
  writeFileSync(join(OUT_DIR, name), out)
  console.log(`  ${name}  (${out.length} bytes)`)
}

/** 標準の A4 セクション */
const SECT_A4 = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>`

function ruby(base: string, rt: string): string {
  return (
    `<w:r><w:ruby>` +
    `<w:rubyPr><w:rubyAlign w:val="distributeSpace"/><w:hps w:val="10"/><w:hpsRaise w:val="22"/><w:hpsBaseText w:val="21"/><w:lid w:val="ja-JP"/></w:rubyPr>` +
    `<w:rt><w:r><w:rPr><w:rFonts w:hint="eastAsia"/><w:sz w:val="10"/></w:rPr><w:t>${rt}</w:t></w:r></w:rt>` +
    `<w:rubyBase><w:r><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr><w:t>${base}</w:t></w:r></w:rubyBase>` +
    `</w:ruby></w:r>`
  )
}

function text(s: string): string {
  return `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`
}

function para(...runs: string[]): string {
  return `<w:p>${runs.join('')}</w:p>`
}

/** 06: ルビつき日本語文書 */
function rubyDoc(): string {
  return (
    para(text('次の語には振り仮名が付いています。')) +
    para(ruby('薔薇', 'ばら'), text('と'), ruby('向日葵', 'ひまわり'), text('。')) +
    para(text('契約書では'), ruby('甲', 'こう'), text('および'), ruby('乙', 'おつ'), text('と表記する。')) +
    SECT_A4
  )
}

/** 07: 文字数と行数 = 40 字 × 36 行、B5 */
function gridDoc(): string {
  // B5 = 182 x 257mm = 10319 x 14570 twip
  // 本文幅 = 10319 - 1701*2 = 6917 twip = 345.85pt
  // 40 字 → 文字送り 8.646pt。標準 10.5pt なので charSpace = (8.646-10.5)*4096 = -7594
  // 本文高 = 14570 - 1440*2 = 11690 twip = 584.5pt。36 行 → 行送り 16.236pt = 324 twip
  const sect =
    `<w:sectPr>` +
    `<w:pgSz w:w="10319" w:h="14570"/>` +
    `<w:pgMar w:top="1440" w:right="1701" w:bottom="1440" w:left="1701" w:header="851" w:footer="992" w:gutter="0"/>` +
    `<w:docGrid w:type="linesAndChars" w:linePitch="324" w:charSpace="-7594"/>` +
    `</w:sectPr>`

  const body = Array.from({ length: 6 }, (_, i) =>
    para(text(`第${i + 1}段落。原稿用紙の設定を確認するための本文です。`))
  ).join('')
  return body + sect
}

/** 08: 結合セル・罫線・網かけを含む表 */
function tableDoc(): string {
  const borders =
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>` +
    `</w:tblBorders>`

  const cell = (content: string, props = ''): string =>
    `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/>${props}</w:tcPr>${para(text(content))}</w:tc>`

  return (
    para(text('次は表です。')) +
    `<w:tbl>` +
    `<w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>` +
    // ヘッダー行。網かけつき
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>` +
    cell('項目', '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>') +
    cell('内容', '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>') +
    cell('備考', '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>') +
    `</w:tr>` +
    // 横結合
    `<w:tr>` +
    cell('結合セル', '<w:gridSpan w:val="2"/>') +
    cell('右端') +
    `</w:tr>` +
    // 縦結合の開始
    `<w:tr>` +
    cell('縦結合', '<w:vMerge w:val="restart"/>') +
    cell('1 行目') +
    cell('あ') +
    `</w:tr>` +
    `<w:tr>` +
    cell('', '<w:vMerge/>') +
    cell('2 行目') +
    cell('い') +
    `</w:tr>` +
    `</w:tbl>` +
    para(text('表の後の段落。')) +
    SECT_A4
  )
}

/** 09: ヘッダー / フッターとページ番号フィールド */
function fieldsDoc(): string {
  const pageField =
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:t>1</w:t></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`

  return (
    para(text('本文にページ番号フィールドを置きます: '), `<w:fldSimple w:instr=" PAGE  \\* MERGEFORMAT "><w:r><w:t>1</w:t></w:r></w:fldSimple>`) +
    para(text('合計 '), `<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple>`, text(' ページ')) +
    para(pageField) +
    `<w:p><w:bookmarkStart w:id="1" w:name="_Toc_章1"/>${text('ブックマーク付きの段落。')}<w:bookmarkEnd w:id="1"/></w:p>` +
    SECT_A4
  )
}

/** 10: 変更履歴とコメント範囲 */
function revisionsDoc(): string {
  const ins =
    `<w:ins w:id="101" w:author="校閲者A" w:date="2026-01-01T00:00:00Z">` +
    `<w:r><w:t xml:space="preserve">挿入された文</w:t></w:r></w:ins>`
  const del =
    `<w:del w:id="102" w:author="校閲者B" w:date="2026-01-02T00:00:00Z">` +
    `<w:r><w:delText xml:space="preserve">削除された文</w:t></w:r></w:del>`.replace(
      '</w:t>',
      '</w:delText>'
    )

  return (
    para(text('変更履歴つきの段落: '), ins, text(' と '), del, text('。')) +
    `<w:p>` +
    `<w:commentRangeStart w:id="1"/>` +
    text('コメントが付いた範囲') +
    `<w:commentRangeEnd w:id="1"/>` +
    `<w:r><w:commentReference w:id="1"/></w:r>` +
    `</w:p>` +
    SECT_A4
  )
}

/** 13: 目次の材料になる見出し構成 */
function headingsDoc(): string {
  const heading = (text: string, level: number): string =>
    `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

  return (
    heading('第1章 総則', 1) +
    para(text('第1章の本文です。')) +
    heading('第1節 目的', 2) +
    para(text('第1節の本文です。')) +
    heading('第2章 実施', 1) +
    para(text('第2章の本文です。')) +
    SECT_A4
  )
}

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

/** 12: インライン画像 */
function imageDoc(): string {
  // 8x8 の画像を 1 インチ角 (914400 EMU) で置く
  const drawing =
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="914400" cy="914400"/>` +
    `<wp:docPr id="1" name="図 1" descr="青い四角"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="sample.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rId100"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`

  return (
    para(text('次は画像です。')) +
    para(`<w:r>${drawing}</w:r>`) +
    para(text('画像の後の段落。')) +
    SECT_A4
  )
}

/** 11: 堅牢性の確認用。深い入れ子と大量の段落 */
function hostileDoc(): string {
  const many = Array.from({ length: 400 }, (_, i) => para(text(`段落 ${i + 1}`))).join('')
  // 未知の要素。raw として退避され、保存時にそのまま書き戻されるべきもの
  const unknown = `<w:p><w:r><w:t>未知要素の前</w:t></w:r><w:someUnknownElement w:val="1"><w:child/></w:someUnknownElement><w:r><w:t>後</w:t></w:r></w:p>`
  const deepTable = (depth: number): string => {
    if (depth === 0) return para(text('最深部'))
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>${deepTable(depth - 1)}</w:tc></w:tr></w:tbl>`
    )
  }
  return unknown + deepTable(6) + many + SECT_A4
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log('OOXML を直接書いたフィクスチャを生成します:')
  emit('06-ruby.docx', 'blank-ja-b5.docx', rubyDoc())
  emit('07-grid-40x36.docx', 'blank-ja-b5.docx', gridDoc())
  emit('08-tables.docx', 'blank-a4.docx', tableDoc())
  emit('09-fields.docx', 'blank-a4.docx', fieldsDoc())
  emit('10-revisions.docx', 'blank-a4.docx', revisionsDoc())
  emit('11-hostile.docx', 'blank-a4.docx', hostileDoc())
  emit('13-headings.docx', 'blank-a4.docx', headingsDoc())
  emit('12-image.docx', 'blank-a4.docx', imageDoc(), {
    parts: new Map([['word/media/image1.png', new Uint8Array(readFileSync(SAMPLE_PNG))]]),
    rels: [{ id: 'rId100', type: IMAGE_REL, target: 'media/image1.png' }],
    contentTypes: [{ extension: 'png', contentType: 'image/png' }]
  })
  console.log('完了')
}

main()
