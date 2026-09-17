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
import {
  openPackage,
  savePackage,
  ensureDefaultContentType,
  ensureOverrideContentType
} from '../src/core/docx/package'

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
  /** [Content_Types].xml に足すパートごとの指定 (ヘッダーなど) */
  overrideTypes?: { partName: string; contentType: string }[]
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

  if (extra.contentTypes?.length || extra.overrideTypes?.length) {
    let types = new TextDecoder().decode(pkg.parts.get('[Content_Types].xml')!)
    for (const ct of extra.contentTypes ?? []) {
      types = ensureDefaultContentType(types, ct.extension, ct.contentType)
    }
    for (const ct of extra.overrideTypes ?? []) {
      types = ensureOverrideContentType(types, ct.partName, ct.contentType)
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

/** w:comments パートを 1 件だけ持つ最小の中身 */
function singleCommentPart(id: string, author: string, body: string): Uint8Array {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
    `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">` +
    `<w:comment w:id="${id}" w:author="${author}" w:initials="X" w:date="2026-01-05T00:00:00Z">` +
    `<w:p w14:paraId="44444444"><w:r><w:t xml:space="preserve">${body}</w:t></w:r></w:p>` +
    `</w:comment></w:comments>`
  return new TextEncoder().encode(xml)
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

  // 段落記号そのものの挿入と削除 (w:pPr/w:rPr の w:ins / w:del)。
  // Enter や BackSpace を記録中に押したときに Word が書く形
  const paraInserted =
    `<w:p><w:pPr><w:rPr>` +
    `<w:ins w:id="103" w:author="校閲者A" w:date="2026-01-03T00:00:00Z"/>` +
    `<w:b/></w:rPr></w:pPr>` +
    text('段落記号が挿入された段落。') +
    `</w:p>`
  const paraDeleted =
    `<w:p><w:pPr><w:rPr>` +
    `<w:del w:id="104" w:author="校閲者B" w:date="2026-01-04T00:00:00Z"/>` +
    `</w:rPr></w:pPr>` +
    text('段落記号が削除された段落。') +
    `</w:p>`

  return (
    para(text('変更履歴つきの段落: '), ins, text(' と '), del, text('。')) +
    paraInserted +
    paraDeleted +
    `<w:p>` +
    `<w:commentRangeStart w:id="1"/>` +
    text('コメントが付いた範囲') +
    `<w:commentRangeEnd w:id="1"/>` +
    `<w:r><w:commentReference w:id="1"/></w:r>` +
    `</w:p>` +
    SECT_A4
  )
}

/** 14: 返信つきスレッドコメント */
function threadedCommentsDoc(): {
  body: string
  comments: string
  extended: string
} {
  const body =
    `<w:p>` +
    `<w:commentRangeStart w:id="0"/>` +
    text('コメントが付いた最初の範囲') +
    `<w:commentRangeEnd w:id="0"/>` +
    `<w:r><w:commentReference w:id="0"/></w:r>` +
    `</w:p>` +
    `<w:p>` +
    `<w:commentRangeStart w:id="2"/>` +
    text('別のコメントが付いた範囲') +
    `<w:commentRangeEnd w:id="2"/>` +
    `<w:r><w:commentReference w:id="2"/></w:r>` +
    `</w:p>` +
    SECT_A4

  const comment = (id: string, author: string, initials: string, paraId: string, content: string): string =>
    `<w:comment w:id="${id}" w:author="${author}" w:initials="${initials}" w:date="2026-01-0${Number(id) + 1}T00:00:00Z">` +
    `<w:p w14:paraId="${paraId}"><w:r><w:t xml:space="preserve">${content}</w:t></w:r></w:p>` +
    `</w:comment>`

  const comments =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
    `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">` +
    comment('0', '校閲者A', 'A', '11111111', 'ここは検討が必要です。') +
    comment('1', '校閲者B', 'B', '22222222', '同意します。修正しました。') +
    comment('2', '校閲者A', 'A', '33333333', '解決済みのコメント。') +
    `</w:comments>`

  // id=1 は id=0 への返信。id=2 は解決済み
  const extended =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ` +
    `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w15">` +
    `<w15:commentEx w15:paraId="11111111" w15:done="0"/>` +
    `<w15:commentEx w15:paraId="22222222" w15:paraIdParent="11111111" w15:done="0"/>` +
    `<w15:commentEx w15:paraId="33333333" w15:done="1"/>` +
    `</w15:commentsEx>`

  return { body, comments, extended }
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
    // 浮動画像 (wp:anchor)。レターヘッドのロゴなどで普通に使われる。
    // 回り込みの種類ごとに読み取りが変わるので、主要な 4 種を入れておく
    para(text('ここから浮動画像です。')) +
    para(`<w:r>${anchoredDrawing('<wp:wrapSquare wrapText="bothSides"/>')}</w:r>`) +
    // wrapTight は wrapPolygon を必ず持つ (CT_WrapTight)
    para(`<w:r>${anchoredDrawing(WRAP_TIGHT)}</w:r>`) +
    para(`<w:r>${anchoredDrawing('<wp:wrapTopAndBottom/>')}</w:r>`) +
    para(`<w:r>${anchoredDrawing('<wp:wrapNone/>', '1')}</w:r>`) +
    para(`<w:r>${anchoredDrawing('<wp:wrapNone/>', '0')}</w:r>`) +
    SECT_A4
  )
}

/** 回り込みの輪郭。wp:wrapTight は wrapPolygon が必須 */
const WRAP_TIGHT =
  `<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0">` +
  `<wp:start x="0" y="0"/>` +
  `<wp:lineTo x="0" y="21600"/>` +
  `<wp:lineTo x="21600" y="21600"/>` +
  `<wp:lineTo x="21600" y="0"/>` +
  `<wp:lineTo x="0" y="0"/>` +
  `</wp:wrapPolygon></wp:wrapTight>`

/** wp:anchor の浮動画像。behindDoc="1" なら本文の背面に回る */
function anchoredDrawing(wrap: string, behindDoc = '0'): string {
  return (
    `<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" ` +
    `simplePos="0" relativeHeight="251658240" behindDoc="${behindDoc}" ` +
    `locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="457200" cy="457200"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    wrap +
    `<wp:docPr id="10" name="浮動図" descr="回り込みの確認"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="sample.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rId100"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`
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

const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'
const FOOTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer'
const HEADER_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
const FOOTER_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'

const HDR_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function hdrPart(tag: 'w:hdr' | 'w:ftr', body: string): Uint8Array {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<${tag} ${HDR_NS}>${body}</${tag}>`
  return new TextEncoder().encode(xml)
}

/**
 * 15: ヘッダーとフッター。
 *
 * 先頭ページ別 (titlePg) と、フッターのページ番号フィールドを含む。
 * ヘッダーを持つフィクスチャが 1 つも無かったため、
 * w:headerReference の往復がこれまで一度も検証されていなかった。
 */
function headerFooterDoc(): { body: string; parts: Map<string, Uint8Array> } {
  const sect =
    `<w:sectPr>` +
    `<w:headerReference w:type="default" r:id="rId101"/>` +
    `<w:headerReference w:type="first" r:id="rId102"/>` +
    `<w:footerReference w:type="default" r:id="rId103"/>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>` +
    `<w:titlePg/>` +
    `</w:sectPr>`

  const body =
    Array.from({ length: 40 }, (_, i) =>
      para(text(`第${i + 1}段落。ヘッダーとフッターを確認するための本文です。`))
    ).join('') + sect

  const pageNumber =
    `<w:fldSimple w:instr=" PAGE  \\* MERGEFORMAT "><w:r><w:t>1</w:t></w:r></w:fldSimple>`

  const parts = new Map<string, Uint8Array>([
    [
      'word/header1.xml',
      hdrPart('w:hdr', `<w:p><w:pPr><w:jc w:val="right"/></w:pPr>${text('社外秘')}</w:p>`)
    ],
    ['word/header2.xml', hdrPart('w:hdr', para(text('先頭ページ専用のヘッダー')))],
    [
      'word/footer1.xml',
      hdrPart(
        'w:ftr',
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${text('- ')}${pageNumber}${text(' -')}</w:p>`
      )
    ]
  ])

  return { body, parts }
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log('OOXML を直接書いたフィクスチャを生成します:')
  emit('06-ruby.docx', 'blank-ja-b5.docx', rubyDoc())
  emit('07-grid-40x36.docx', 'blank-ja-b5.docx', gridDoc())
  emit('08-tables.docx', 'blank-a4.docx', tableDoc())
  emit('09-fields.docx', 'blank-a4.docx', fieldsDoc())
  // 本文がコメント 1 を参照するので、実体も一緒に入れる。
  // 参照だけあって実体が無いと、Word では壊れた文書になる
  emit('10-revisions.docx', 'blank-a4.docx', revisionsDoc(), {
    parts: new Map([
      ['word/comments.xml', singleCommentPart('1', '校閲者C', 'この範囲にコメントを付けました。')]
    ])
  })
  emit('11-hostile.docx', 'blank-a4.docx', hostileDoc())
  emit('13-headings.docx', 'blank-a4.docx', headingsDoc())

  const threaded = threadedCommentsDoc()
  emit('14-comments.docx', 'blank-a4.docx', threaded.body, {
    parts: new Map([
      ['word/comments.xml', new TextEncoder().encode(threaded.comments)],
      ['word/commentsExtended.xml', new TextEncoder().encode(threaded.extended)]
    ])
  })
  emit('12-image.docx', 'blank-a4.docx', imageDoc(), {
    parts: new Map([['word/media/image1.png', new Uint8Array(readFileSync(SAMPLE_PNG))]]),
    rels: [{ id: 'rId100', type: IMAGE_REL, target: 'media/image1.png' }],
    contentTypes: [{ extension: 'png', contentType: 'image/png' }]
  })

  const hf = headerFooterDoc()
  emit('15-headers.docx', 'blank-a4.docx', hf.body, {
    parts: hf.parts,
    rels: [
      { id: 'rId101', type: HEADER_REL, target: 'header1.xml' },
      { id: 'rId102', type: HEADER_REL, target: 'header2.xml' },
      { id: 'rId103', type: FOOTER_REL, target: 'footer1.xml' }
    ],
    overrideTypes: [
      { partName: 'word/header1.xml', contentType: HEADER_TYPE },
      { partName: 'word/header2.xml', contentType: HEADER_TYPE },
      { partName: 'word/footer1.xml', contentType: FOOTER_TYPE }
    ]
  })
  console.log('完了')
}

main()
