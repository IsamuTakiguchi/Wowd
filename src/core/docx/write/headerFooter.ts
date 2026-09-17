import type { WowdDocument, WowdDoc, SectionProps } from '../../model/types'
import { REL_TYPE, resolveRelTarget, relsPartNameFor, type DocxPackage } from '../package'
import { XML_DECL, wrap } from '../xml'
import { rootAttrsOf, applyRootAttrs, ensureIgnorable, ROOT_ATTR_PLACEHOLDER } from './rootAttrs'
import { writeBlocks } from './body'

/**
 * ヘッダー / フッターのパートを書く。
 *
 * それぞれ独立したパートで、中身は本文と同じブロックの並び。
 * 関係 ID (`w:headerReference`) でセクションと結び付く。
 *
 * まだパートを持たない文書にヘッダーを付ける場合は、
 * パート・関係・コンテンツタイプ・セクションの参照の 4 つを揃える。
 * 1 つでも欠けると Word 側でヘッダーが現れない。
 */

const HDR_FTR_ATTRS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'mc:Ignorable="w14"'

export const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
export const FOOTER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'

/** w:hdr または w:ftr のパート本体を組み立てる */
export function writeHeaderFooterXml(
  doc: WowdDoc,
  kind: 'header' | 'footer',
  originalXml: string | null = null
): string {
  const tag = kind === 'header' ? 'w:hdr' : 'w:ftr'
  // セクションは持たないので空の Map を渡す。ヘッダーの中に sectPr は来ない
  const body = writeBlocks(doc.content, new Map())
  // 空でも段落を 1 つ置く。Word は中身の無い w:hdr を嫌う
  return (
    XML_DECL +
    applyRootAttrs(
      wrap(tag, ROOT_ATTR_PLACEHOLDER, body || wrap('w:p', undefined, '')),
      ensureIgnorable(rootAttrsOf(originalXml, tag, HDR_FTR_ATTRS), ['w14'])
    )
  )
}

/** 使われていないパート名を選ぶ */
export function nextHeaderFooterPart(pkg: DocxPackage, kind: 'header' | 'footer'): string {
  for (let i = 1; i < 1000; i++) {
    const name = `word/${kind}${i}.xml`
    if (!pkg.parts.has(name)) return name
  }
  return `word/${kind}-${Date.now()}.xml`
}

/** セクションが参照しているヘッダー / フッターの関係 ID をすべて集める */
function referencedIds(sections: SectionProps[]): Set<string> {
  const out = new Set<string>()
  for (const section of sections) {
    for (const refs of [section.headerRefs, section.footerRefs]) {
      for (const id of Object.values(refs)) {
        if (id) out.add(id)
      }
    }
  }
  return out
}

/**
 * 変更されたヘッダー / フッターを書き戻す。
 *
 * 参照されている関係 ID だけを対象にする。文書から外された
 * ヘッダーのパートはバイト列のまま残す (消すと元に戻せない)。
 */
export function writeHeadersFooters(
  doc: WowdDocument,
  pkg: DocxPackage,
  overrides: Map<string, Uint8Array | string | null>
): void {
  const used = referencedIds(doc.resources.sections)

  for (const rel of doc.resources.rels.byId.values()) {
    const kind =
      rel.type === REL_TYPE.header ? 'header' : rel.type === REL_TYPE.footer ? 'footer' : null
    if (!kind || !used.has(rel.id)) continue

    const source = kind === 'header' ? doc.resources.headers : doc.resources.footers
    const content = source.get(rel.id)
    if (!content) continue

    const partName = resolveRelTarget(doc.resources.documentPartName, rel.target)
    const original = pkg.parts.get(partName)
    overrides.set(
      partName,
      writeHeaderFooterXml(content, kind, original ? new TextDecoder().decode(original) : null)
    )
  }
}

/** ヘッダー / フッターを新しく作るときに要る 3 つ (パート名・関係 ID・書き出し先) */
export interface NewHeaderFooter {
  partName: string
  relId: string
  relsPart: string
  relTarget: string
  contentType: string
}

/**
 * 新しいヘッダー / フッターの置き場所を決める。
 *
 * 実際に書き出すのは呼び出し側。ここは名前と ID を決めるだけで、
 * モデル (resources) への登録と組み合わせて使う。
 */
export function planHeaderFooter(
  doc: WowdDocument,
  pkg: DocxPackage,
  kind: 'header' | 'footer'
): NewHeaderFooter {
  const partName = nextHeaderFooterPart(pkg, kind)
  return {
    partName,
    relId: `rId${doc.resources.rels.nextId}`,
    relsPart: relsPartNameFor(doc.resources.documentPartName),
    relTarget: partName.replace(/^word\//, ''),
    contentType: kind === 'header' ? HEADER_CONTENT_TYPE : FOOTER_CONTENT_TYPE
  }
}
