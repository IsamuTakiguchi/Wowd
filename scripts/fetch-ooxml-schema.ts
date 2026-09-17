/**
 * ECMA-376 の XSD (Transitional) を取得する。
 *
 * 使い方: npm run schema:fetch
 *
 * Wowd が書くのは Transitional (名前空間 .../wordprocessingml/2006/main)。
 * 紛らわしいが、Transitional のスキーマは **Part 4** の配布物に入っている。
 * Part 1 (5th edition) に入っているのは Strict (purl.oclc.org 系) だけで、
 * 名前空間が違うので使えない。
 *
 * リポジトリにはコミットしない。取得してキャッシュするだけにして、
 * 出所を ECMA に一本化する。
 */
import { writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { SCHEMA_DIR, WML_XSD } from './schema-paths'

/** ECMA-376 5th edition Part 4 "Transitional Migration Features" */
const ECMA_PART4 =
  'https://ecma-international.org/wp-content/uploads/ECMA-376-4_5th_edition_december_2016.zip'

/** xsd:import の schemaLocation が無いので、別途これを置く */
const XML_XSD = 'https://www.w3.org/2001/xml.xsd'


async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} を取得できません: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** zip の中から名前で 1 件取り出す */
function pick(zip: Record<string, Uint8Array>, suffix: string): Uint8Array {
  const name = Object.keys(zip).find((n) => n.endsWith(suffix))
  if (!name) throw new Error(`zip に ${suffix} がありません`)
  return zip[name]!
}

/**
 * 公式 XSD にそのまま xmllint をかけると 2 か所で止まる。
 *
 * xml:space (xml:lang なども) を使う xsd:import に schemaLocation が無く、
 * libxml2 は自動取得しない。同じディレクトリに置いた xml.xsd を指させる。
 */
function patchXmlImport(xsd: string): string {
  return xsd.replace(
    /<xsd:import\s+namespace="http:\/\/www\.w3\.org\/XML\/1998\/namespace"\s*\/>/g,
    '<xsd:import namespace="http://www.w3.org/XML/1998/namespace" schemaLocation="xml.xsd"/>'
  )
}

async function main(): Promise<void> {
  if (existsSync(WML_XSD) && !process.argv.includes('--force')) {
    console.log(`取得済み: ${SCHEMA_DIR} (--force で取り直し)`)
    return
  }

  console.log('ECMA-376 Part 4 から Transitional の XSD を取得します...')
  const outer = unzipSync(await download(ECMA_PART4))
  const inner = unzipSync(pick(outer, 'OfficeOpenXML-XMLSchema-Transitional.zip'))

  rmSync(SCHEMA_DIR, { recursive: true, force: true })
  mkdirSync(SCHEMA_DIR, { recursive: true })

  let count = 0
  for (const [name, data] of Object.entries(inner)) {
    if (!name.endsWith('.xsd')) continue
    const base = name.split('/').pop()!
    writeFileSync(join(SCHEMA_DIR, base), patchXmlImport(strFromU8(data)))
    count++
  }

  writeFileSync(join(SCHEMA_DIR, 'xml.xsd'), await download(XML_XSD))

  writeFileSync(
    join(SCHEMA_DIR, 'README.txt'),
    [
      'ECMA-376 5th edition (December 2016) Part 4 "Transitional Migration Features" の',
      'OfficeOpenXML-XMLSchema-Transitional.zip を展開したもの。',
      '',
      `取得元: ${ECMA_PART4}`,
      `xml.xsd: ${XML_XSD}`,
      '',
      '公式からの変更点は 1 つだけ:',
      '  xsd:import namespace="http://www.w3.org/XML/1998/namespace" に',
      '  schemaLocation="xml.xsd" を追記した (libxml2 が自動取得しないため)。',
      '',
      'このディレクトリは生成物なのでリポジトリにはコミットしない。',
      'npm run schema:fetch で取り直せる。'
    ].join('\n')
  )

  console.log(`  ${count} 個の .xsd と xml.xsd を ${SCHEMA_DIR} に置きました`)
  console.log(`  ${readdirSync(SCHEMA_DIR).length} ファイル`)
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
