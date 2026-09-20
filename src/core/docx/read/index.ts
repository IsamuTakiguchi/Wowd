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
import {
  parseXml,
  assertWellFormed,
  tagOf,
  attr,
  findChild,
  findChildren,
  intAttr,
  boolVal,
  type XNode
} from '../xml'
import { readBody } from './body'
import { readStyles, emptyStyleTable } from './styles'
import { readNumbering } from './numbering'
import { readComments } from './comments'
import { unsupportedLabels, LAYOUT_LIMITS } from '../unsupportedLabels'
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
  const commentsPart = relTargetPart(pkg, rels, REL_TYPE.comments)
  // commentsExtended は関係を持たないことがあるのでパート名で直接探す
  const extendedPart = [...pkg.parts.keys()].find((n) => n.endsWith('commentsExtended.xml')) ?? null

  const documentXml = readPartText(pkg, pkg.documentPartName)
  if (!documentXml) throw new Error('本文パートを読めませんでした')
  // パーサは壊れた XML でも「読めたところまで」を黙って返す。
  // 本文でそれが起きると空の文書として開いてしまい、
  // そのまま保存すれば原本が空で上書きされる。開く前に止める
  assertWellFormed(documentXml, pkg.documentPartName)

  // 画像は関係 ID からメディアパートを引く。
  // rels は本文パートから相対で解決する
  const resolveMedia = (relId: string): string | null => {
    const rel = rels.byId.get(relId)
    if (!rel || rel.type !== REL_TYPE.image || rel.targetMode === 'External') return null
    const part = resolveRelTarget(pkg.documentPartName, rel.target)
    return pkg.parts.has(part) ? part : null
  }

  // 本文中の w:commentReference を載せているランの書式。
  // 参照は書き出しで作り直すので、ここで拾っておかないと書式が失われる
  const commentRefProps = new Map<string, string>()

  const ctx: RunContext = {
    revision: null,
    commentIds: [],
    unsupported: new Set(),
    resolveMedia,
    commentRefProps
  }

  const root = parseXml(documentXml).find((n) => tagOf(n) === 'w:document')
  const body = findChild(root, 'w:body')
  const { blocks, sections, trailingSectionId } = body
    ? readBody(body, ctx)
    : { blocks: [], sections: [], trailingSectionId: null }

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
    comments: commentsPart
      ? readComments(
          readPartText(pkg, commentsPart),
          extendedPart ? readPartText(pkg, extendedPart) : null,
          ctx
        )
      : new Map(),
    headers,
    footers,
    media: collectMedia(pkg, rels),
    rels,
    rawParts: pkg.parts,
    contentTypes: readPartText(pkg, '[Content_Types].xml') ?? '',
    documentPartName: pkg.documentPartName,
    trailingSectionId
  }

  // 参照ランの書式を各コメントに移す。
  // comments.xml を読む時点では本文をまだ見ていないので、ここで差し込む
  for (const [id, rPr] of commentRefProps) {
    const record = resources.comments.get(id)
    if (record) record.refRPr = rPr
  }

  return {
    filePath,
    doc,
    resources,
    unsupported: [...unsupportedLayout(resources, ctx.unsupported), ...unsupportedLabels([...ctx.unsupported])],
    pkg
  }
}

/**
 * 読み取りも往復もできるが、**画面に描けない**指定を拾う。
 *
 * 黙って 1 段で描くと、利用者は「Wowd で開いたら段組みが消えた」と思う。
 * 実際には保存すれば元のまま書き戻されるので、消えてはいない。
 * それを知らせるために、未対応として名前を挙げる。
 *
 * ページ分割が「1 本の縦の流れ + 空白の挿し込み」でできているため、
 * 段を横に並べる描画がそもそも載らない。直すにはページ分割の作りから変える。
 */
function unsupportedLayout(resources: WowdResources, tags: ReadonlySet<string>): string[] {
  const out: string[] = []
  if (resources.sections.some((s) => (s.cols?.num ?? 1) > 1)) out.push(LAYOUT_LIMITS.columns)
  // 脚注そのものはタグ名から拾える。ここで言うのは**置き場所**の話
  if (tags.has('w:footnoteReference') || tags.has('w:endnoteReference')) {
    out.push(LAYOUT_LIMITS.footnotePlacement)
  }
  return out
}
