import type { WowdDocument, SectionProps } from '../../model/types'
import { savePackage, type DocxPackage } from '../package'
import { XML_DECL, wrap } from '../xml'
import { writeBody } from './body'
import { writeNumbering } from './numbering'

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

  return savePackage(pkg, { overrides })
}

function findNumberingPart(pkg: DocxPackage): string | null {
  for (const name of pkg.parts.keys()) {
    if (name.endsWith('/numbering.xml') || name === 'numbering.xml') return name
  }
  return null
}
