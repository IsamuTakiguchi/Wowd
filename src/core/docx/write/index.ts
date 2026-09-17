import type { WowdDocument, SectionProps, MediaEntry } from '../../model/types'
import {
  savePackage,
  ensureOverrideContentType,
  ensureDefaultContentType,
  ensureRelationship,
  relsPartNameFor,
  resolveRelTarget,
  REL_TYPE,
  type DocxPackage
} from '../package'
import { XML_DECL, wrap } from '../xml'
import { writeBody } from './body'
import { writeNumbering } from './numbering'
import { writeComments, writeCommentsExtended } from './comments'
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
  const body = writeBody(doc.doc, sections, doc.resources.trailingSectionId)
  // 属性は生文字列として差し込む必要があるため、いったん目印を入れて置換する
  return XML_DECL + wrap('w:document', { __attrs: '' }, body).replace('__attrs=""', documentRootAttrs(originalXml))
}

export interface WriteOptions {
  /** numbering.xml も書き直すか。リストを編集したときだけ true にする */
  numberingChanged?: boolean
  /** comments.xml も書き直すか。コメントを編集したときだけ true にする */
  commentsChanged?: boolean
  /** ヘッダー / フッターのパートも書き直すか */
  headersChanged?: boolean
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
    const numberingPart = findNumberingPart(pkg)
    if (numberingPart) overrides.set(numberingPart, writeNumbering(doc.resources.numbering))
  }

  if (options.commentsChanged) {
    const commentsPart = findPart(pkg, 'comments.xml')
    if (commentsPart) overrides.set(commentsPart, writeComments(doc.resources.comments))
    writeExtendedComments(doc, pkg, overrides)
  }

  if (options.headersChanged) {
    writeHeadersFooters(doc, pkg, overrides)
    ensureHeaderFooterParts(doc, pkg, overrides)
  }

  writeNewMedia(doc, pkg, overrides)

  return savePackage(pkg, { overrides })
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
  let relsXml = decodePart(pkg, relsPart)
  let contentTypes = decodePart(pkg, '[Content_Types].xml')
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
  let relsXml = decodePart(pkg, relsPart)
  let contentTypes = decodePart(pkg, '[Content_Types].xml')

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
  overrides.set(partName, writeCommentsExtended(doc.resources.comments))
  if (existing) return

  // 新規に作る場合は関係とコンテンツタイプも足す
  const relsPart = relsPartNameFor(doc.resources.documentPartName)
  const relsXml = decodePart(pkg, relsPart)
  if (relsXml) {
    const id = `rId${doc.resources.rels.nextId}`
    const target = partName.replace(/^word\//, '')
    overrides.set(relsPart, ensureRelationship(relsXml, id, EXTENDED_REL_TYPE, target))
  }

  const contentTypes = decodePart(pkg, '[Content_Types].xml')
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

function findNumberingPart(pkg: DocxPackage): string | null {
  return findPart(pkg, 'numbering.xml')
}

function findPart(pkg: DocxPackage, fileName: string): string | null {
  for (const name of pkg.parts.keys()) {
    if (name.endsWith(`/${fileName}`) || name === fileName) return name
  }
  return null
}
