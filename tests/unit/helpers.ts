import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'docx')

/** 生成フィクスチャが無ければ作る。CI でも `npm test` 一発で回るようにするため */
function ensureFixtures(): void {
  if (existsSync(join(FIXTURE_DIR, '01-plain.docx'))) return
  execFileSync('npx', ['tsx', 'scripts/make-fixtures.ts'], { stdio: 'inherit' })
}

/** 生成フィクスチャと、利用者が置いた実物 Word ファイル (real-*.docx) の両方を返す */
export function fixtureNames(): string[] {
  ensureFixtures()
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.docx'))
    .sort()
}

export function readFixture(name: string): Uint8Array {
  ensureFixtures()
  return new Uint8Array(readFileSync(join(FIXTURE_DIR, name)))
}
