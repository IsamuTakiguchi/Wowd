import type { WowdDocument, SectionProps, MediaEntry } from '../../model/types'
import {
  savePackage,
  ensureOverrideContentType,
  ensureDefaultContentType,
  ensureRelationship,
  ensureUpdateFields,
  relsPartNameFor,
  resolveRelTarget,
  REL_TYPE,
  type DocxPackage
} from '../package'
import { XML_DECL, wrap, escapeXml } from '../xml'
import { writeBody } from './body'
import { writeNumbering } from './numbering'
import { writeStyles } from './styles'
import { writeComments, writeCommentsExtended } from './comments'
import { ensureIgnorable } from './rootAttrs'
import {
  writeHeadersFooters,
  HEADER_CONTENT_TYPE,
  FOOTER_CONTENT_TYPE
} from './headerFooter'

/**
 * w:document のルート要素に必要な名前空間宣言。
 * 元ファイルの宣言をそのまま使えるのが理想だが、最低限これだけあれば Word は開ける。
 */
const DOCUMENT_ATTRS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'mc:Ignorable="w14"'

/** 元の w:document 開始タグから名前空間宣言を取り出す。取れなければ既定を使う */
export function documentRootAttrs(originalXml: string | null): string {
  if (!originalXml) return DOCUMENT_ATTRS
  const m = /<w:document\b([^>]*)>/.exec(originalXml)
  const attrs = m?.[1]?.trim()
  return attrs && attrs.length > 0 ? attrs : DOCUMENT_ATTRS
}

export function writeDocumentXml(doc: WowdDocument, originalXml: string | null): string {
  const sections = new Map<string, SectionProps>(doc.resources.sections.map((s) => [s.id, s]))
  const body = writeBody(doc.doc, sections, doc.resources.trailingSectionId, doc.resources.comments)
  // 段落に w14:paraId を書くので、宣言と mc:Ignorable を揃える
  const attrs = ensureIgnorable(documentRootAttrs(originalXml), ['w14'])
  // 属性は生文字列として差し込む必要があるため、いったん目印を入れて置換する
  return XML_DECL + wrap('w:document', { __attrs: '' }, body).replace('__attrs=""', attrs)
}

export interface WriteOptions {
  /** numbering.xml も書き直すか。リストを編集したときだけ true にする */
  numberingChanged?: boolean
  /** styles.xml も書き直すか。スタイルを足したり置き換えたりしたときだけ true にする */
  stylesChanged?: boolean
  /** comments.xml も書き直すか。コメントを編集したときだけ true にする */
  commentsChanged?: boolean
  /** ヘッダー / フッターのパートも書き直すか */
  headersChanged?: boolean
  /**
   * 目次を作った、または作り直したか。
   *
   * settings.xml に w:updateFields を立てて、Word 側でページ番号を
   * 計算し直させる。目次を触っていないときに settings.xml を
   * 書き換えないよう、明示的に指示されたときだけ立てる。
   */
  tocChanged?: boolean
}

/**
 * 文書を .docx のバイト列にする。
 *
 * 元パッケージの全パートから始め、書き換えるのは document.xml と
 * 実際に変更したパートだけ。それ以外はバイト列のまま通す。
 */
export function writeDocx(
  doc: WowdDocument,
  pkg: DocxPackage,
  options: WriteOptions = {}
): Uint8Array {
  const original = pkg.parts.get(doc.resources.documentPartName)
  const originalXml = original ? new TextDecoder().decode(original) : null

  const overrides = new Map<string, Uint8Array | string | null>()
  overrides.set(doc.resources.documentPartName, writeDocumentXml(doc, originalXml))

  if (options.numberingChanged) {
    // 原本のルート属性を引き継ぐ。落とすと、原文のまま書き戻した
    // w15:tentative などの接頭辞が未宣言になり、Word が開けなくなる
    writeDocumentPart(doc, pkg, overrides, {
      fileName: 'numbering.xml',
      relType: REL_TYPE.numbering,
      contentType: NUMBERING_CONTENT_TYPE,
      build: (original) => writeNumbering(doc.resources.numbering, original)
    })
  }

  if (options.stylesChanged) {
    writeDocumentPart(doc, pkg, overrides, {
      fileName: 'styles.xml',
      relType: REL_TYPE.styles,
      contentType: STYLES_CONTENT_TYPE,
      build: (original) => writeStyles(doc.resources.styles, original)
    })
  }

  if (options.commentsChanged) {
    const commentsPart = findPart(pkg, 'comments.xml')
    if (commentsPart) {
      overrides.set(
        commentsPart,
        writeComments(doc.resources.comments, decodePart(pkg, commentsPart))
      )
    }
    writeExtendedComments(doc, pkg, overrides)
  }

  if (options.headersChanged) {
    writeHeadersFooters(doc, pkg, overrides)
    ensureHeaderFooterParts(doc, pkg, overrides)
  }

  if (options.tocChanged) {
    const settingsPart = findPart(pkg, 'settings.xml')
    const settingsXml = settingsPart ? decodePart(pkg, settingsPart) : null
    if (settingsPart && settingsXml) {
      overrides.set(settingsPart, ensureUpdateFields(settingsXml))
    }
  }

  writeNewMedia(doc, pkg, overrides)
  writeNewHyperlinks(doc, pkg, overrides)

  return savePackage(pkg, { overrides })
}

const NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
const STYLES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'

/**
 * 本文から関係で参照される 1 枚もののパート (numbering.xml / styles.xml) を書く。
 *
 * 原本にあれば上書きし、無ければパート・関係・コンテンツタイプをまとめて作る。
 * 番号やスタイルを持たない .docx (他のソフトが作ったもの) に連番を振ったとき、
 * パートを作らないと保存した時点で番号が消える。
 */
function writeDocumentPart(
  doc: WowdDocument,
  pkg: DocxPackage,
  overrides: Map<string, Uint8Array | string | null>,
  spec: {
    fileName: string
    relType: string
    contentType: string
    build: (originalXml: string | null) => string
  }
): void {
  const existing = findPart(pkg, spec.fileName)
  if (existing) {
    overrides.set(existing, spec.build(decodePart(pkg, existing)))
    return
  }

  const partName = `word/${spec.fileName}`
  overrides.set(partName, spec.build(null))

  const relsPart = relsPartNameFor(doc.resources.documentPartName)
  const relsXml = latestPart(pkg, overrides, relsPart)
  if (relsXml) {
    overrides.set(relsPart, ensureRelationship(relsXml, freeRelId(relsXml, doc), spec.relType, spec.fileName))
  }
  const contentTypes = latestPart(pkg, overrides, '[Content_Types].xml')
  if (contentTypes) {
    overrides.set(
      '[Content_Types].xml',
      ensureOverrideContentType(contentTypes, partName, spec.contentType)
    )
  }
}

/**
 * いま書こうとしている版のパート。先に別の処理が書き換えていればそちらを返す。
 *
 * 関係 (.rels) とコンテンツタイプは、画像・コメント・番号など複数の処理が
 * それぞれ足しにくる。原本から読み直すと、前の処理が足した分を上書きで消してしまう。
 */
function latestPart(
  pkg: DocxPackage,
  overrides: Map<string, Uint8Array | string | null>,
  name: string
): string | null {
  const pending = overrides.get(name)
  if (typeof pending === 'string') return pending
  if (pending instanceof Uint8Array) return new TextDecoder().decode(pending)
  return decodePart(pkg, name)
}

/** .rels と文書の関係表のどちらとも重ならない rId */
function freeRelId(relsXml: string, doc: WowdDocument): string {
  let max = doc.resources.rels.nextId - 1
  for (const m of relsXml.matchAll(/\bId="rId(\d+)"/g)) max = Math.max(max, Number(m[1]))
  return `rId${max + 1}`
}

/**
 * 元パッケージに無いヘッダー / フッターのパートに、関係とコンテンツタイプを足す。
 *
 * パートの中身は writeHeadersFooters が既に overrides に入れている。
 * 関係とコンテンツタイプが無いと、書いたパートを Word が見つけられない。
 */
function ensureHeaderFooterParts(
  doc: WowdDocument,
  pkg: DocxPackage,
  overrides: Map<string, Uint8Array | string | null>
): void {
  const relsPart = relsPartNameFor(doc.resources.documentPartName)
  let relsXml = latestPart(pkg, overrides, relsPart)
  let contentTypes = latestPart(pkg, overrides, '[Content_Types].xml')
  let changed = false

  for (const rel of doc.resources.rels.byId.values()) {
    const kind =
      rel.type === REL_TYPE.header ? 'header' : rel.type === REL_TYPE.footer ? 'footer' : null
    if (!kind) continue
    const partName = resolveRelTarget(doc.resources.documentPartName, rel.target)
    // すでにパッケージにあるものは関係もコンテンツタイプも揃っている
    if (pkg.parts.has(partName)) continue
    if (!overrides.has(partName)) continue

    changed = true
    if (relsXml) relsXml = ensureRelationship(relsXml, rel.id, rel.type, rel.target)
    if (contentTypes) {
      contentTypes = ensureOverrideContentType(
        contentTypes,
        partName,
        kind === 'header' ? HEADER_CONTENT_TYPE : FOOTER_CONTENT_TYPE
      )
    }
  }

  if (!changed) return
  if (relsXml) overrides.set(relsPart, relsXml)
  if (contentTypes) overrides.set('[Content_Types].xml', contentTypes)
}

const IMAGE_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

/**
 * 元パッケージに無かった画像パートを足す。
 *
 * 画像を挿入すると resources.media と resources.rels には載るが、
 * パッケージには入っていない。バイト列・関係・コンテンツタイプの
 * 3 つが揃わないと Word は画像を見つけられない。
 */
function writeNewMedia(
  doc: WowdDocument,
  pkg: DocxPackage,
  overrides: Map<string, Uint8Array | string | null>
): void {
  const added: { key: string; entry: MediaEntry }[] = []
  for (const [key, entry] of doc.resources.media) {
    if (pkg.parts.has(key)) continue
    added.push({ key, entry })
  }
  if (added.length === 0) return

  const relsPart = relsPartNameFor(doc.resources.documentPartName)
  let relsXml = latestPart(pkg, overrides, relsPart)
  let contentTypes = latestPart(pkg, overrides, '[Content_Types].xml')

  for (const { key, entry } of added) {
    overrides.set(key, entry.bytes)

    // 関係。挿入側が採番した rId を使う。合わないと本文から参照できない
    const target = key.replace(/^word\//, '')
    const rel = [...doc.resources.rels.byId.values()].find((r) => r.target === target)
    if (relsXml && rel) {
      relsXml = ensureRelationship(relsXml, rel.id, IMAGE_REL_TYPE, target)
    }

    // 拡張子ごとの既定コンテンツタイプ
    const ext = key.split('.').pop() ?? ''
    if (contentTypes && ext) {
      contentTypes = ensureDefaultContentType(contentTypes, ext, entry.contentType)
    }
  }

  if (relsXml) overrides.set(relsPart, relsXml)
  if (contentTypes) overrides.set('[Content_Types].xml', contentTypes)
}

/**
 * 新しく挿入したハイパーリンクの関係を足す。
 *
 * 外部リンクの行き先は本文ではなく .rels に入る (TargetMode="External")。
 * 本文の r:id だけ書いて関係を足さないと、Word は文書が壊れていると言う。
 * 原本の .rels にすでにある Id は触らない。
 */
function writeNewHyperlinks(
  doc: WowdDocument,
  pkg: DocxPackage,
  overrides: Map<string, Uint8Array | string | null>
): void {
  const relsPart = relsPartNameFor(doc.resources.documentPartName)
  let relsXml = latestPart(pkg, overrides, relsPart)
  if (!relsXml) return
  let changed = false
  for (const rel of doc.resources.rels.byId.values()) {
    if (rel.type !== REL_TYPE.hyperlink || rel.targetMode !== 'External') continue
    if (new RegExp(`\\bId="${rel.id}"`).test(relsXml)) continue
    const entry = `<Relationship Id="${escapeXml(rel.id)}" Type="${REL_TYPE.hyperlink}" Target="${escapeXml(rel.target)}" TargetMode="External"/>`
    relsXml = relsXml.replace('</Relationships>', `${entry}</Relationships>`)
    changed = true
  }
  if (changed) overrides.set(relsPart, relsXml)
}

/** commentsExtended のパート名・関係・コンテンツタイプ */
const EXTENDED_PART = 'word/commentsExtended.xml'
const EXTENDED_REL_TYPE =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'
const EXTENDED_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml'

/**
 * commentsExtended.xml を書く。
 *
 * このパートはスレッドの親子関係と解決状態を持つ。
 * 文書にまだ無ければ、パート・関係・コンテンツタイプをまとめて作る。
 * 作らないと、返信も「解決済み」も保存した時点で失われる。
 */
function writeExtendedComments(
  doc: WowdDocument,
  pkg: DocxPackage,
  overrides: Map<string, Uint8Array | string | null>
): void {
  const existing = findPart(pkg, 'commentsExtended.xml')
  const partName = existing ?? EXTENDED_PART
  overrides.set(
    partName,
    writeCommentsExtended(doc.resources.comments, existing ? decodePart(pkg, existing) : null)
  )
  if (existing) return

  // 新規に作る場合は関係とコンテンツタイプも足す
  const relsPart = relsPartNameFor(doc.resources.documentPartName)
  const relsXml = latestPart(pkg, overrides, relsPart)
  if (relsXml) {
    const id = freeRelId(relsXml, doc)
    const target = partName.replace(/^word\//, '')
    overrides.set(relsPart, ensureRelationship(relsXml, id, EXTENDED_REL_TYPE, target))
  }

  const contentTypes = latestPart(pkg, overrides, '[Content_Types].xml')
  if (contentTypes) {
    overrides.set(
      '[Content_Types].xml',
      ensureOverrideContentType(contentTypes, partName, EXTENDED_CONTENT_TYPE)
    )
  }
}

function decodePart(pkg: DocxPackage, name: string): string | null {
  const bytes = pkg.parts.get(name)
  return bytes ? new TextDecoder().decode(bytes) : null
}

function findPart(pkg: DocxPackage, fileName: string): string | null {
  for (const name of pkg.parts.keys()) {
    if (name.endsWith(`/${fileName}`) || name === fileName) return name
  }
  return null
}
