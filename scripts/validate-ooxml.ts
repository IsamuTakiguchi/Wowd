/**
 * .docx を ECMA-376 の XSD に当てて検証する CLI。
 *
 * 使い方: npm run schema:validate -- <file.docx> [...]
 *
 * 実体は scripts/lib/validateOoxml.ts にある (テストから読み込めるように、
 * 副作用のあるこのファイルとは分けてある)。
 */
import { readFileSync } from 'node:fs'
import { validateDocx, schemaAvailable, xmllintAvailable } from './lib/validateOoxml'

function main(): void {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('使い方: npm run schema:validate -- <file.docx> [...]')
    process.exit(2)
  }
  if (!schemaAvailable()) {
    console.error('XSD がありません。先に npm run schema:fetch を実行してください')
    process.exit(2)
  }
  if (!xmllintAvailable()) {
    console.error('xmllint がありません (libxml2-utils)')
    process.exit(2)
  }

  let failed = 0
  for (const file of files) {
    const problems = validateDocx(new Uint8Array(readFileSync(file)), file)
    if (problems.length === 0) {
      console.log(`OK  ${file}`)
      continue
    }
    failed++
    console.error(`NG  ${file}`)
    for (const p of problems.slice(1)) console.error(`      ${p.part}: ${p.message}`)
  }

  console.log(failed === 0 ? '\nすべて規格どおりです' : `\n${failed} 件が規格違反です`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
