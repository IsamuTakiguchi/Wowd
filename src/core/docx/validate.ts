import {
  CONTENT_TYPES_PART,
  relsPartNameFor,
  resolveRelTarget,
  REL_TYPE,
  readPartText,
  type DocxPackage
} from './package'

/**
 * パッケージ整合性の検査。
 *
 * XSD による検証は**各パートを単体でしか見ない**。パート単体としては正しくても、
 * パッケージ全体の参照グラフが閉じていなければ Word は開けない (または中身が出ない)。
 *
 *   r:embed="rId5" が .rels に無い          → 画像が空欄になる
 *   .rels の Target が実在しないパートを指す → Word が修復を出す
 *   パートに Content_Types の指定が無い       → そもそも開けない
 *   commentRangeStart に対応する End が無い   → コメントが壊れる
 *
 * 実際にこの種類の不具合を 2 度作り込んでいる (画像の関係、ヘッダーの参照)。
 * どちらも往復テストは素通りした。参照が切れていても、読み直したモデルは
 * 「参照が切れた状態」として同じに見えるため。
 *
 * DOM にも Electron にも依存しない。文字列と正規表現だけで見る。
 * ここで XML パーサを使うと、壊れたパートを検査しようとして
 * 検査自体が落ちる (検査は壊れた入力にこそ効いてほしい)。
 */

export type Severity = 'error' | 'warning'

export interface PackageProblem {
  severity: Severity
  /** 問題のあるパート名 */
  part: string
  message: string
}

/** 本文と同じ関係を持ちうるパート。ここに載るものは r:id の解決を検査する */
const RELATIONSHIP_BEARING = /^word\/(document\.xml|header\d*\.xml|footer\d*\.xml|footnotes\.xml|endnotes\.xml|comments\.xml)$/

/** 関係を表す属性。いずれもそのパート自身の .rels を指す */
const REL_ATTRS = ['r:id', 'r:embed', 'r:link']

interface Relationship {
  id: string
  type: string
  target: string
  external: boolean
}

/** .rels を読む。壊れていても落ちずに、読めた分だけ返す */
function readRelationships(xml: string): Relationship[] {
  const out: Relationship[] = []
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0]
    const id = /\bId\s*=\s*"([^"]*)"/.exec(tag)?.[1]
    if (!id) continue
    out.push({
      id,
      type: /\bType\s*=\s*"([^"]*)"/.exec(tag)?.[1] ?? '',
      target: /\bTarget\s*=\s*"([^"]*)"/.exec(tag)?.[1] ?? '',
      external: /\bTargetMode\s*=\s*"External"/.test(tag)
    })
  }
  return out
}

/** [Content_Types].xml の Default (拡張子) と Override (パート) */
function readContentTypes(xml: string): { defaults: Set<string>; overrides: Set<string> } {
  const defaults = new Set<string>()
  for (const m of xml.matchAll(/<Default\b[^>]*>/g)) {
    const ext = /\bExtension\s*=\s*"([^"]*)"/.exec(m[0])?.[1]
    if (ext) defaults.add(ext.toLowerCase())
  }
  const overrides = new Set<string>()
  for (const m of xml.matchAll(/<Override\b[^>]*>/g)) {
    const part = /\bPartName\s*=\s*"([^"]*)"/.exec(m[0])?.[1]
    if (part) overrides.add(part.replace(/^\//, ''))
  }
  return { defaults, overrides }
}

/** 開始タグの属性値を全部集める */
function attrValues(xml: string, tagName: string, attr: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'g')
  const attrRe = new RegExp(`\\b${attr.replace(':', '\\:')}\\s*=\\s*"([^"]*)"`)
  for (const m of xml.matchAll(re)) {
    const v = attrRe.exec(m[0])?.[1]
    if (v != null) out.push(v)
  }
  return out
}

/**
 * 開始と終了が対応する範囲要素を検査する。
 *
 * w:commentRangeStart / End や w:bookmarkStart / End は、
 * 対応が崩れると Word 側で範囲が壊れる。
 */
function checkRangePairs(
  xml: string,
  part: string,
  startTag: string,
  endTag: string,
  problems: PackageProblem[]
): void {
  const starts = attrValues(xml, startTag, 'w:id')
  const ends = attrValues(xml, endTag, 'w:id')

  for (const id of new Set(starts)) {
    if (!ends.includes(id)) {
      problems.push({
        severity: 'error',
        part,
        message: `${startTag} w:id="${id}" に対応する ${endTag} がありません`
      })
    }
  }
  for (const id of new Set(ends)) {
    if (!starts.includes(id)) {
      problems.push({
        severity: 'error',
        part,
        message: `${endTag} w:id="${id}" に対応する ${startTag} がありません`
      })
    }
  }
}

/** パッケージ全体の参照グラフが閉じているかを見る */
export function validatePackage(pkg: DocxPackage): PackageProblem[] {
  const problems: PackageProblem[] = []
  const add = (severity: Severity, part: string, message: string): void => {
    problems.push({ severity, part, message })
  }

  // ── 1. 全パートに Content_Types の指定があるか ──
  const contentTypesXml = readPartText(pkg, CONTENT_TYPES_PART)
  if (!contentTypesXml) {
    add('error', CONTENT_TYPES_PART, '[Content_Types].xml がありません')
    return problems
  }
  const { defaults, overrides } = readContentTypes(contentTypesXml)

  for (const part of pkg.parts.keys()) {
    if (part === CONTENT_TYPES_PART) continue
    if (overrides.has(part)) continue
    const ext = part.includes('.') ? (part.split('.').pop() ?? '').toLowerCase() : ''
    if (ext && defaults.has(ext)) continue
    add('error', part, 'Content_Types に指定 (Default も Override も) がありません')
  }

  // ── 2 と 3. 関係の解決 ──
  /** パート名 → そのパートの関係 */
  const relsOf = new Map<string, Relationship[]>()

  for (const [part] of pkg.parts) {
    if (!part.includes('/_rels/') && !part.startsWith('_rels/')) continue
    if (!part.endsWith('.rels')) continue

    const xml = readPartText(pkg, part)
    if (xml == null) continue
    const rels = readRelationships(xml)

    // .rels のパート名から、持ち主のパート名を戻す
    const owner = part.replace(/(^|\/)_rels\//, '$1').replace(/\.rels$/, '')
    relsOf.set(owner, rels)

    for (const rel of rels) {
      if (rel.external || rel.target === '') continue
      const resolved = resolveRelTarget(owner, rel.target)
      if (!pkg.parts.has(resolved)) {
        add('error', part, `${rel.id} の Target が実在しません: ${rel.target} → ${resolved}`)
      }
    }

    const ids = rels.map((r) => r.id)
    for (const id of new Set(ids)) {
      if (ids.filter((x) => x === id).length > 1) {
        add('error', part, `関係 ID が重複しています: ${id}`)
      }
    }
  }

  // ── 3. 本文側の r:id / r:embed / r:link が、そのパート自身の .rels にあるか ──
  for (const [part] of pkg.parts) {
    if (!RELATIONSHIP_BEARING.test(part)) continue
    const xml = readPartText(pkg, part)
    if (xml == null) continue

    const known = new Set((relsOf.get(part) ?? []).map((r) => r.id))
    const used = new Set<string>()
    for (const attr of REL_ATTRS) {
      const re = new RegExp(`\\b${attr.replace(':', '\\:')}\\s*=\\s*"([^"]*)"`, 'g')
      for (const m of xml.matchAll(re)) {
        if (m[1]) used.add(m[1])
      }
    }
    for (const id of used) {
      if (!known.has(id)) {
        add('error', part, `${id} を参照していますが ${relsPartNameFor(part)} にありません`)
      }
    }
  }

  // ── 4 と 6. コメント ──
  const commentsXml = readPartText(pkg, 'word/comments.xml')
  const commentIds = commentsXml ? attrValues(commentsXml, 'w:comment', 'w:id') : []

  if (commentsXml) {
    for (const id of new Set(commentIds)) {
      if (commentIds.filter((x) => x === id).length > 1) {
        add('error', 'word/comments.xml', `コメントの w:id が重複しています: ${id}`)
      }
    }
  }

  const documentXml = readPartText(pkg, pkg.documentPartName)
  if (documentXml) {
    checkRangePairs(
      documentXml,
      pkg.documentPartName,
      'w:commentRangeStart',
      'w:commentRangeEnd',
      problems
    )

    // 参照先のコメントが実在するか
    const referenced = [
      ...attrValues(documentXml, 'w:commentReference', 'w:id'),
      ...attrValues(documentXml, 'w:commentRangeStart', 'w:id')
    ]
    for (const id of new Set(referenced)) {
      if (!commentIds.includes(id)) {
        add(
          'error',
          pkg.documentPartName,
          `コメント ${id} を参照していますが comments.xml にありません`
        )
      }
    }

    // ── 5. ブックマーク ──
    checkRangePairs(
      documentXml,
      pkg.documentPartName,
      'w:bookmarkStart',
      'w:bookmarkEnd',
      problems
    )

    // ── 7. ヘッダー / フッターの参照 ──
    const docRels = new Map((relsOf.get(pkg.documentPartName) ?? []).map((r) => [r.id, r]))
    for (const [tag, expected] of [
      ['w:headerReference', REL_TYPE.header],
      ['w:footerReference', REL_TYPE.footer]
    ] as const) {
      for (const id of attrValues(documentXml, tag, 'r:id')) {
        const rel = docRels.get(id)
        // 参照そのものの欠落は 3 で報告済み。ここでは型だけ見る
        if (rel && rel.type !== expected) {
          add('error', pkg.documentPartName, `${tag} の ${id} が ${expected} ではありません`)
        }
      }
    }

    // ── 8. 改訂 ID の重複 (警告) ──
    const revisionIds = [
      ...attrValues(documentXml, 'w:ins', 'w:id'),
      ...attrValues(documentXml, 'w:del', 'w:id')
    ]
    const duplicated = new Set(
      revisionIds.filter((id, i) => revisionIds.indexOf(id) !== i && id !== '0')
    )
    for (const id of duplicated) {
      add('warning', pkg.documentPartName, `改訂の w:id が重複しています: ${id}`)
    }
  }

  return problems
}

/** 検査結果を人が読める 1 行ずつの文字列にする */
export function formatProblems(problems: PackageProblem[]): string {
  return problems
    .map((p) => `  ${p.severity === 'error' ? 'NG' : '警告'}  ${p.part}: ${p.message}`)
    .join('\n')
}

/** error だけを取り出す。warning は保存を止めるほどではない */
export function errorsOnly(problems: PackageProblem[]): PackageProblem[] {
  return problems.filter((p) => p.severity === 'error')
}
