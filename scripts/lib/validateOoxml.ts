/**
 * .docx の各パートを ECMA-376 の XSD に当てて検証する。
 *
 * CLI は scripts/validate-ooxml.ts。ここは読み込んでも副作用が無い。
 *
 * これまで子要素の順序は手書きの順序テーブル (write/order.ts) が正だった。
 * テーブル自体が間違っていたら誰も気づけない。実際 w:headerReference が
 * 漏れていたし、罫線の辺の順序も規定違反だった。
 * 公式 XSD に当てれば、順序・必須属性・値の型を総当たりで見られる。
 */
import { writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { unzipSync, strFromU8 } from 'fflate'
import { stripIgnorableMarkup } from '../../src/core/docx/mce'
import { SCHEMA_DIR, WML_XSD } from '../schema-paths'

export interface SchemaProblem {
  part: string
  message: string
}

/**
 * XSD に当てるパート。
 *
 * commentsExtended.xml / people.xml などは ECMA-376 に無い Microsoft 独自パート。
 * 対応する公式スキーマが存在しないので検証できない。
 * 黙って飛ばすと「なぜか検証されていない」になるので、ここに理由ごと書いておく。
 */
const WML_PARTS =
  /^word\/(document\.xml|header\d*\.xml|footer\d*\.xml|footnotes\.xml|endnotes\.xml|comments\.xml|styles\.xml|numbering\.xml|settings\.xml|fontTable\.xml|webSettings\.xml)$/

export function schemaAvailable(): boolean {
  return existsSync(WML_XSD)
}

/** xmllint が使えるか */
export function xmllintAvailable(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * 1 つの .docx を検証する。
 *
 * MCE の前処理をしてから当てる。Word が書く拡張 (w14:paraId など) は
 * mc:Ignorable で「知らない消費者は無視してよい」と宣言されており、
 * 落としてから当てるのが規格に沿った消費者の振る舞い。
 */
export function validateDocx(bytes: Uint8Array, label: string): SchemaProblem[] {
  const parts = unzipSync(bytes)
  const problems: SchemaProblem[] = []
  const work = mkdtempSync(join(tmpdir(), 'wowd-xsd-'))

  try {
    for (const [part, data] of Object.entries(parts)) {
      if (!WML_PARTS.test(part)) continue

      const cleaned = stripIgnorableMarkup(strFromU8(data))
      const file = join(work, part.replace(/\//g, '_'))
      writeFileSync(file, cleaned)

      try {
        execFileSync('xmllint', ['--noout', '--schema', WML_XSD, file], {
          stdio: ['ignore', 'ignore', 'pipe'],
          cwd: SCHEMA_DIR
        })
      } catch (err) {
        const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err)
        for (const line of stderr.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || /validates$/.test(trimmed)) continue
          // 一時ファイル名が出ても読み手の役に立たない。パート名に直す
          problems.push({ part, message: trimmed.replace(file, part) })
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }

  if (problems.length > 0) {
    problems.unshift({ part: label, message: `${problems.length} 件の違反` })
  }
  return problems
}
