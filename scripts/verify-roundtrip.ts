/**
 * 1 つの .docx を開いて無編集で保存し、元ファイルとの差分を報告する。
 *
 * 使い方: npm run verify:roundtrip -- <file.docx>
 *
 * 期待する結果は docs/round-trip-report.md に書いた「許容済みの差分」のみ。
 * それ以外が出たらバグ。
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { unzipSync, strFromU8 } from 'fflate'
import { readDocx } from '../src/core/docx/read'
import { writeDocx } from '../src/core/docx/write'

const src = process.argv[2]
if (!src) {
  console.error('使い方: npm run verify:roundtrip -- <file.docx>')
  process.exit(2)
}

const original = new Uint8Array(readFileSync(src))
const doc = readDocx(original, src)
const saved = writeDocx(doc, doc.pkg)

const outDir = mkdtempSync(join(tmpdir(), 'wowd-verify-'))
const outFile = join(outDir, 'out.docx')
writeFileSync(outFile, saved)

const before = unzipSync(original)
const after = unzipSync(saved)
const beforeNames = Object.keys(before).filter((n) => !n.endsWith('/')).sort()
const afterNames = Object.keys(after).sort()

let failures = 0
const fail = (msg: string): void => {
  failures++
  console.error(`  NG  ${msg}`)
}

console.log(`検証対象: ${src}`)
console.log(`出力: ${outFile}`)

console.log('\n[1] パート一覧')
for (const name of beforeNames) {
  if (!afterNames.includes(name)) fail(`パートが失われた: ${name}`)
}
const added = afterNames.filter((n) => !beforeNames.includes(n))
if (added.length) console.log(`  追加されたパート: ${added.join(', ')}`)
console.log(`  元 ${beforeNames.length} パート / 出力 ${afterNames.length} パート`)

console.log('\n[2] 書き換えないパートのバイト一致')
let untouched = 0
for (const name of beforeNames) {
  if (name === doc.resources.documentPartName) continue
  const a = before[name]
  const b = after[name]
  if (!a || !b) continue
  if (a.length !== b.length || !a.every((v, i) => v === b[i])) fail(`中身が変わった: ${name}`)
  else untouched++
}
console.log(`  ${untouched} パートがバイト一致`)

console.log('\n[3] 未対応要素 (raw として保持されたもの)')
console.log(doc.unsupported.length ? `  ${doc.unsupported.join(', ')}` : '  なし')

console.log('\n[4] 冪等性 read(write(read(f))) === read(f)')
const second = readDocx(saved, src)
const plain = (d: { content: unknown[] }): string => {
  const parts: string[] = []
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; text?: string; content?: unknown[] }
    if (node.type === 'text' && node.text) parts.push(node.text)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  d.content.forEach(walk)
  return parts.join('')
}
if (plain(second.doc) !== plain(doc.doc)) fail('本文テキストが変化した')
else console.log(`  本文テキスト一致 (${plain(doc.doc).length} 文字)`)

// [5] は目視用。許容済みの差分 (xml:space の有無など) が常に出るので判定には使わない。
// **要素や文字が落ちていないか**の自動判定は tests/unit/roundTripFidelity.test.ts にある。
// ここの差分を人が読み飛ばしたせいで w:pPrChange の欠落を長く見逃した
console.log('\n[5] document.xml の差分 (目視用。判定には使わない)')
try {
  const a = join(outDir, 'a.xml')
  const b = join(outDir, 'b.xml')
  writeFileSync(a, strFromU8(before[doc.resources.documentPartName]!))
  writeFileSync(b, strFromU8(after[doc.resources.documentPartName]!))
  execFileSync('xmllint', ['--format', '--output', a + '.fmt', a])
  execFileSync('xmllint', ['--format', '--output', b + '.fmt', b])
  try {
    execFileSync('diff', ['-u', a + '.fmt', b + '.fmt'], { encoding: 'utf8' })
    console.log('  差分なし')
  } catch (e) {
    const out = (e as { stdout?: string }).stdout ?? ''
    const lines = out.split('\n').filter((l) => /^[+-][^+-]/.test(l))
    console.log(`  ${lines.length} 行の差分 (全文: diff -u ${a}.fmt ${b}.fmt)`)
    console.log(lines.slice(0, 20).map((l) => '    ' + l).join('\n'))
  }
} catch {
  console.log('  xmllint が無いため省略')
}

console.log(failures === 0 ? '\n結果: OK' : `\n結果: NG (${failures} 件)`)
process.exit(failures === 0 ? 0 : 1)
