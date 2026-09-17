import type {
  WowdDocument,
  WowdDoc,
  WowdResources,
  RelationshipTable,
  RelationshipEntry,
  ThemeFonts,
  ThemeColors,
  MediaEntry
} from '../../model/types'
import {
  openPackage,
  readPartText,
  relsPartNameFor,
  resolveRelTarget,
  REL_TYPE,
  type DocxPackage
} from '../package'
import { parseXml, tagOf, attr, findChild, findChildren, intAttr, boolVal, type XNode } from '../xml'
import { readBody } from './body'
import { readStyles, emptyStyleTable } from './styles'
import { readNumbering } from './numbering'
import { defaultSection } from './section'
import type { RunContext } from './run'
import { emptyNumberingTable } from '../../numbering/resolve'

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf'
}

function readRelationships(pkg: DocxPackage, partName: string): RelationshipTable {
  const table: RelationshipTable = { byId: new Map(), nextId: 1 }
  const xml = readPartText(pkg, relsPartNameFor(partName))
  if (!xml) return table

  const root = parseXml(xml).find((n) => tagOf(n) === 'Relationships')
  if (!root) return table

  let maxId = 0
  for (const node of findChildren(root, 'Relationship')) {
    const id = attr(node, 'Id')
    const type = attr(node, 'Type')
    const target = attr(node, 'Target')
    if (!id || !type || !target) continue
    const entry: RelationshipEntry = {
      id,
      type,
      target,
      targetMode: attr(node, 'TargetMode') ?? null
    }
    table.byId.set(id, entry)
    const num = Number(/^rId(\d+)$/.exec(id)?.[1] ?? 0)
    if (Number.isFinite(num)) maxId = Math.max(maxId, num)
  }
  table.nextId = maxId + 1
  return table
}

function relTargetPart(pkg: DocxPackage, rels: RelationshipTable, relType: string): string | null {
  for (const rel of rels.byId.values()) {
    if (rel.type !== relType) continue
    if (rel.targetMode === 'External') continue
    const part = resolveRelTarget(pkg.documentPartName, rel.target)
    if (pkg.parts.has(part)) return part
  }
  return null
}

function readTheme(xml: string | null): ThemeFonts & ThemeColors {
  const fallback: ThemeFonts & ThemeColors = {
    majorFont: { latin: '', ea: '', cs: '' },
    minorFont: { latin: '', ea: '', cs: '' },
    colors: new Map()
  }
  if (!xml) return fallback

  const root = parseXml(xml).find((n) => tagOf(n) === 'a:theme')
  const scheme = findChild(findChild(root, 'a:themeElements'), 'a:fontScheme')
  const pick = (node: XNode | undefined): { latin: string; ea: string; cs: string } => ({
    latin: attr(findChild(node, 'a:latin'), 'typeface') ?? '',
    ea: attr(findChild(node, 'a:ea'), 'typeface') ?? '',
    cs: attr(findChild(node, 'a:cs'), 'typeface') ?? ''
  })
  if (scheme) {
    fallback.majorFont = pick(findChild(scheme, 'a:majorFont'))
    fallback.minorFont = pick(findChild(scheme, 'a:minorFont'))
  }

  const colorScheme = findChild(findChild(root, 'a:themeElements'), 'a:clrScheme')
  if (colorScheme) {
    for (const entry of (colorScheme['a:clrScheme'] as XNode[] | undefined) ?? []) {
      const name = tagOf(entry).replace(/^a:/, '')
      const srgb = attr(findChild(entry, 'a:srgbClr'), 'val')
      const sys = attr(findChild(entry, 'a:sysClr'), 'lastClr')
      const value = srgb ?? sys
      if (value) fallback.colors.set(name, value)
    }
  }
  return fallback
}

function readSettings(xml: string | null): WowdResources['settings'] {
  if (!xml) return { defaultTabStop: 840, trackChanges: false, rawXml: null }
  const root = parseXml(xml).find((n) => tagOf(n) === 'w:settings')
  return {
    defaultTabStop: intAttr(findChild(root, 'w:defaultTabStop'), 'w:val') ?? 840,
    trackChanges: boolVal(findChild(root, 'w:trackChanges')),
    rawXml: xml
  }
}

function collectMedia(pkg: DocxPackage, rels: RelationshipTable): Map<string, MediaEntry> {
  const media = new Map<string, MediaEntry>()
  for (const rel of rels.byId.values()) {
    if (rel.type !== REL_TYPE.image || rel.targetMode === 'External') continue
    const part = resolveRelTarget(pkg.documentPartName, rel.target)
    const bytes = pkg.parts.get(part)
    if (!bytes) continue
    const ext = part.split('.').pop()?.toLowerCase() ?? ''
    media.set(part, { bytes, contentType: MEDIA_CONTENT_TYPES[ext] ?? 'application/octet-stream' })
  }
  return media
}

export interface ReadDocxResult extends WowdDocument {
  /** 保存時にパートを差し替えるため、元のパッケージを保持する */
  pkg: DocxPackage
}

/**
 * .docx のバイト列を読み込んで編集可能なモデルにする。
 *
 * 理解できるパートだけを解析し、それ以外は rawParts にバイト列のまま残す。
 * 本文中の未対応要素も rawBlock / rawRun として原文を抱えるので、
 * 保存しても情報は落ちない。
 */
export function readDocx(bytes: Uint8Array, filePath: string | null = null): ReadDocxResult {
  const pkg = openPackage(bytes)
  const rels = readRelationships(pkg, pkg.documentPartName)

  const stylesPart = relTargetPart(pkg, rels, REL_TYPE.styles)
  const numberingPart = relTargetPart(pkg, rels, REL_TYPE.numbering)
  const settingsPart = relTargetPart(pkg, rels, REL_TYPE.settings)
  const themePart = relTargetPart(pkg, rels, REL_TYPE.theme)

  const documentXml = readPartText(pkg, pkg.documentPartName)
  if (!documentXml) throw new Error('本文パートを読めませんでした')

  const ctx: RunContext = { revision: null, commentIds: [], unsupported: new Set() }

  const root = parseXml(documentXml).find((n) => tagOf(n) === 'w:document')
  const body = findChild(root, 'w:body')
  const { blocks, sections } = body
    ? readBody(body, ctx)
    : { blocks: [], sections: [] }

  const doc: WowdDoc = { type: 'doc', content: blocks }

  // ヘッダー / フッターも同じ読み方をした小さな文書として持つ
  const headers = new Map<string, WowdDoc>()
  const footers = new Map<string, WowdDoc>()
  for (const rel of rels.byId.values()) {
    const isHeader = rel.type === REL_TYPE.header
    const isFooter = rel.type === REL_TYPE.footer
    if (!isHeader && !isFooter) continue
    const part = resolveRelTarget(pkg.documentPartName, rel.target)
    const xml = readPartText(pkg, part)
    if (!xml) continue
    const partRoot = parseXml(xml).find((n) => tagOf(n) === (isHeader ? 'w:hdr' : 'w:ftr'))
    if (!partRoot) continue
    const sub = readBody(partRoot, ctx)
    ;(isHeader ? headers : footers).set(rel.id, { type: 'doc', content: sub.blocks })
  }

  const resources: WowdResources = {
    sections: sections.length ? sections : [defaultSection('sect1')],
    styles: stylesPart ? readStyles(readPartText(pkg, stylesPart)) : emptyStyleTable(),
    numbering: numberingPart ? readNumbering(readPartText(pkg, numberingPart)) : emptyNumberingTable(),
    theme: themePart ? readTheme(readPartText(pkg, themePart)) : readTheme(null),
    settings: readSettings(settingsPart ? readPartText(pkg, settingsPart) : null),
    comments: new Map(),
    headers,
    footers,
    media: collectMedia(pkg, rels),
    rels,
    rawParts: pkg.parts,
    contentTypes: readPartText(pkg, '[Content_Types].xml') ?? '',
    documentPartName: pkg.documentPartName
  }

  return {
    filePath,
    doc,
    resources,
    unsupported: [...ctx.unsupported].sort(),
    pkg
  }
}
