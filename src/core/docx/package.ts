/**
 * .docx パッケージ (OPC / zip) の入出力。
 *
 * このモジュールの責務は「パートの束をそのまま出し入れすること」だけで、
 * XML の意味は一切解釈しない。
 *
 * 保存はパッケージ保存型ラウンドトリップ:
 *   開いたときの全パートを Map に保持し、保存時は実際に変更したパートだけを
 *   差し替えて、それ以外は 1 バイトも変えずに書き戻す。
 *   生成型ライブラリのように「知らないパートを落とす」ことは絶対にしない。
 *   theme1.xml / settings.xml の rsid / fontTable.xml / customXml などを失うと
 *   Word で開いたときに目に見えて壊れるため。
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

/** 展開後の 1 パートあたり上限。zip bomb 対策 */
const MAX_PART_BYTES = 256 * 1024 * 1024
/** 展開後の合計上限 */
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
/** パート数の上限 */
const MAX_PARTS = 5000

/** zip が表現できる最古の日付付近。保存出力を再現可能にするために固定で使う */
const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 2))

export const CONTENT_TYPES_PART = '[Content_Types].xml'
export const ROOT_RELS_PART = '_rels/.rels'

export const REL_TYPE = {
  officeDocument:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
} as const

export interface DocxPackage {
  /** パート名 (zip 内のパス) → 生バイト列。開いたときの全パートを保持する */
  parts: Map<string, Uint8Array>
  /** officeDocument 関係から解決した本文パート名。通常 'word/document.xml' */
  documentPartName: string
}

export class DocxPackageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocxPackageError'
  }
}

/**
 * zip 内のパート名は外部入力なので検証する。
 * 絶対パス・親ディレクトリ参照・NUL を弾く。
 */
function assertSafePartName(name: string): void {
  if (name.length === 0 || name.length > 2048) {
    throw new DocxPackageError(`パート名が不正です: ${name.slice(0, 64)}`)
  }
  if (name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
    throw new DocxPackageError(`パート名が不正です: ${name}`)
  }
  if (name.split('/').some((seg) => seg === '..')) {
    throw new DocxPackageError(`パート名に親ディレクトリ参照が含まれます: ${name}`)
  }
}

/** ディレクトリエントリ (末尾 /) は保持しない */
function isDirectoryEntry(name: string): boolean {
  return name.endsWith('/')
}

export function openPackage(bytes: Uint8Array): DocxPackage {
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(bytes)
  } catch (err) {
    throw new DocxPackageError(
      `.docx として読めませんでした: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const names = Object.keys(raw)
  if (names.length > MAX_PARTS) {
    throw new DocxPackageError(`パート数が多すぎます (${names.length})`)
  }

  const parts = new Map<string, Uint8Array>()
  let total = 0
  for (const name of names) {
    if (isDirectoryEntry(name)) continue
    assertSafePartName(name)
    const data = raw[name]
    if (!data) continue
    if (data.length > MAX_PART_BYTES) {
      throw new DocxPackageError(`パートが大きすぎます: ${name}`)
    }
    total += data.length
    if (total > MAX_TOTAL_BYTES) {
      throw new DocxPackageError('展開後のサイズが上限を超えました')
    }
    parts.set(name, data)
  }

  if (!parts.has(CONTENT_TYPES_PART)) {
    throw new DocxPackageError('[Content_Types].xml がありません。.docx ではない可能性があります')
  }

  return { parts, documentPartName: resolveDocumentPartName(parts) }
}

/**
 * _rels/.rels から officeDocument パートを解決する。
 * 'word/document.xml' と決め打ちしない — マクロ有効文書や一部の生成物では異なる。
 */
export function resolveDocumentPartName(parts: Map<string, Uint8Array>): string {
  const rels = parts.get(ROOT_RELS_PART)
  if (rels) {
    const xml = strFromU8(rels)
    const re = /<Relationship\b[^>]*>/g
    for (const m of xml.matchAll(re)) {
      const tag = m[0]
      if (!tag.includes(REL_TYPE.officeDocument)) continue
      const target = /\bTarget\s*=\s*"([^"]*)"/.exec(tag)?.[1]
      if (target) {
        const normalized = target.replace(/^\/+/, '')
        if (parts.has(normalized)) return normalized
      }
    }
  }
  if (parts.has('word/document.xml')) return 'word/document.xml'
  throw new DocxPackageError('本文パート (officeDocument) が見つかりません')
}

/** 'word/document.xml' → 'word/_rels/document.xml.rels' */
export function relsPartNameFor(partName: string): string {
  const idx = partName.lastIndexOf('/')
  const dir = idx === -1 ? '' : partName.slice(0, idx)
  const file = idx === -1 ? partName : partName.slice(idx + 1)
  return dir ? `${dir}/_rels/${file}.rels` : `_rels/${file}.rels`
}

/** 'word/document.xml' と '../media/image1.png' から 'media/image1.png' を解決する */
export function resolveRelTarget(sourcePart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const idx = sourcePart.lastIndexOf('/')
  const baseSegments = idx === -1 ? [] : sourcePart.slice(0, idx).split('/')
  const segments = [...baseSegments]
  for (const seg of target.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') segments.pop()
    else segments.push(seg)
  }
  return segments.join('/')
}

export interface SavePackageOptions {
  /**
   * 差し替える / 追加するパート。値が null のパートは削除する。
   * ここに現れないパートは元のバイト列のまま出力される。
   */
  overrides?: Map<string, Uint8Array | string | null>
}

/**
 * パッケージを zip に書き戻す。
 *
 * zip コンテナのバイト列は deflate 実装に依存するため元ファイルと同一にはならないが、
 * 「各パートの中身」は差し替えたもの以外 1 バイトも変わらない。保証すべきはそちら。
 */
export function savePackage(pkg: DocxPackage, options: SavePackageOptions = {}): Uint8Array {
  const out: Record<string, Uint8Array> = {}

  for (const [name, bytes] of pkg.parts) {
    out[name] = bytes
  }

  for (const [name, value] of options.overrides ?? []) {
    assertSafePartName(name)
    if (value === null) {
      delete out[name]
      continue
    }
    out[name] = typeof value === 'string' ? strToU8(value) : value
  }

  if (!out[CONTENT_TYPES_PART]) {
    throw new DocxPackageError('[Content_Types].xml を含まないパッケージは保存できません')
  }

  // 出力を再現可能にするため mtime は固定する。
  // zip の日付は 1980-2099 しか表現できないので、その下限付近を使う。
  return zipSync(out, { level: 6, mtime: ZIP_EPOCH })
}

export function readPartText(pkg: DocxPackage, partName: string): string | null {
  const bytes = pkg.parts.get(partName)
  return bytes ? stripBom(strFromU8(bytes)) : null
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/**
 * [Content_Types].xml に拡張子の既定エントリが無ければ追加する。
 * 画像を新規に埋め込むときに必要。
 */
/**
 * [Content_Types].xml に特定パートの Override を追加する。
 * 既定の拡張子では表せないパート (commentsExtended など) に必要。
 */
export function ensureOverrideContentType(
  contentTypesXml: string,
  partName: string,
  contentType: string
): string {
  const path = partName.startsWith('/') ? partName : `/${partName}`
  if (contentTypesXml.includes(`PartName="${path}"`)) return contentTypesXml
  const entry = `<Override PartName="${path}" ContentType="${contentType}"/>`
  return contentTypesXml.replace('</Types>', `${entry}</Types>`)
}

/** _rels に関係を追加する。既に同じ Target があれば何もしない */
export function ensureRelationship(
  relsXml: string,
  id: string,
  type: string,
  target: string
): string {
  if (relsXml.includes(`Target="${target}"`)) return relsXml
  const entry = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`
  return relsXml.replace('</Relationships>', `${entry}</Relationships>`)
}

export function ensureDefaultContentType(
  contentTypesXml: string,
  extension: string,
  contentType: string
): string {
  const ext = extension.replace(/^\./, '').toLowerCase()
  const re = new RegExp(`<Default\\b[^>]*Extension\\s*=\\s*"${ext}"`, 'i')
  if (re.test(contentTypesXml)) return contentTypesXml
  const entry = `<Default Extension="${ext}" ContentType="${contentType}"/>`
  return contentTypesXml.replace(/(<Types\b[^>]*>)/, `$1${entry}`)
}
