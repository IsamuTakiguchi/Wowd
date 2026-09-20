import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 配布設定と本体のパス解決が食い違っていないか。
 *
 * **パッケージした版でしか出ない壊れ方がある。**
 * 実際に、新規文書のテンプレートを electron-builder の files に入れていたため
 * asar の中 (resources/app.asar/resources/templates) に入り、
 * 本体が見る process.resourcesPath/templates には無く、
 * パッケージ版でだけ「新規作成」が失敗していた。
 * 開発時は別の枝を通るので、単体テストにも E2E にも映らない。
 *
 * 実際にビルドして確かめるのが本筋だが、成果物は 100MB を超えるので
 * CI で毎回回すには重い。ここでは**設定と実装の対応**だけを見る。
 */

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

describe('配布設定', () => {
  const builder = read('electron-builder.yml')
  const files = read('src/main/ipc/files.ts')

  it('テンプレートを asar の外に置いている', () => {
    // 本体は process.resourcesPath/templates を見る
    expect(files, 'テンプレートの解決先が変わった').toContain(
      "join(process.resourcesPath, 'templates')"
    )
    // 配布設定はそこへ置く
    expect(builder, 'extraResources にテンプレートが無い').toMatch(
      /extraResources:[\s\S]*from:\s*resources\/templates[\s\S]*to:\s*templates/
    )
    // files に入れると asar の中に入ってしまう
    expect(builder, 'templates が files に入っている (asar の中になる)').not.toMatch(
      /^\s*-\s*resources\/templates/m
    )
  })

  it('アイコンを指定している', () => {
    expect(builder).toMatch(/^icon:\s*resources\/icon\.png/m)
  })

  it('.deb に必要なメンテナ情報がある', () => {
    const pkg = JSON.parse(read('package.json')) as { author?: { email?: string } }
    expect(pkg.author?.email, 'author.email が無いと .deb を作れない').toBeTruthy()
  })
})
