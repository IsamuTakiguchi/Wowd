import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let app: ElectronApplication
let page: Page

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'docx')

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.wowd-content', { timeout: 30_000 })
})

test.afterAll(async () => {
  await app.close()
})

/** 文書の骨格。エディタを通しても変わってはいけないもの */
interface Skeleton {
  text: string
  blocks: number
  tables: number[][][]
  rubies: string[]
  fields: string[]
  error: string | null
}

async function openBytes(bytes: number[]): Promise<void> {
  await page.evaluate(async (data) => {
    const store = (
      window as unknown as {
        __wowdStore: {
          getState: () => { openBytes: (b: Uint8Array, p: string | null) => Promise<void> }
        }
      }
    ).__wowdStore
    await store.getState().openBytes(new Uint8Array(data), null)
  }, bytes)
  await page.waitForTimeout(500)
}

async function skeleton(): Promise<Skeleton> {
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __wowdStore: {
          getState: () => {
            document: { doc: { content: unknown[] } } | null
            error: string | null
          }
        }
      }
    ).__wowdStore
    const state = store.getState()
    const content = (state.document?.doc.content ?? []) as Record<string, never>[]

    const text: string[] = []
    const rubies: string[] = []
    const fields: string[] = []
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const n = node as {
        type?: string
        text?: string
        attrs?: Record<string, unknown>
        content?: unknown[]
      }
      if (n.type === 'text' && typeof n.text === 'string') text.push(n.text)
      if (n.type === 'ruby') rubies.push(String(n.attrs?.['rt'] ?? ''))
      if (n.type === 'field') fields.push(String(n.attrs?.['instr'] ?? ''))
      if (Array.isArray(n.content)) n.content.forEach(walk)
    }
    content.forEach(walk)

    // 表は行ごとのセルの [colspan, rowspan]
    const tables: number[][][] = []
    for (const block of content) {
      const b = block as unknown as {
        type: string
        content?: { content?: { attrs: { colspan: number; rowspan: number } }[] }[]
      }
      if (b.type !== 'table') continue
      tables.push(
        (b.content ?? []).map((row) =>
          (row.content ?? []).map((cell) => [cell.attrs.colspan, cell.attrs.rowspan]).flat()
        )
      )
    }

    return {
      text: text.join(''),
      blocks: content.length,
      tables,
      rubies,
      fields,
      error: state.error
    }
  })
}

async function saveToBytes(): Promise<number[]> {
  return page.evaluate(async () => {
    const store = (
      window as unknown as {
        __wowdStore: { getState: () => { saveToBytes: () => Promise<number[]> } }
      }
    ).__wowdStore
    return store.getState().saveToBytes()
  })
}

/**
 * 実際の利用経路 (開く → エディタ → 保存 → 開き直す) での往復。
 *
 * モデル層の単体テストはこの経路を通らないので、
 * 「ProseMirror がスキーマに合わせて構造を作り変える」種類の変化を検出できない。
 * 実際に prosemirror-tables が縦結合の行にセルを足していた。
 */
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.docx'))
  .sort()

for (const name of fixtures) {
  test(`${name} がエディタを通しても変わらない`, async () => {
    const bytes = Array.from(new Uint8Array(readFileSync(join(FIXTURE_DIR, name))))

    await openBytes(bytes)
    const before = await skeleton()
    expect(before.error, `${name} を開けなかった`).toBeNull()
    expect(before.text.length, `${name}: 本文が空`).toBeGreaterThan(0)

    const saved = await saveToBytes()
    expect(saved.length, `${name}: 保存できなかった`).toBeGreaterThan(0)

    await openBytes(saved)
    const after = await skeleton()

    expect(after.error, `${name}: 保存したものを開けなかった`).toBeNull()
    expect(after.text, `${name}: 本文テキストが変わった`).toBe(before.text)
    expect(after.blocks, `${name}: ブロック数が変わった`).toBe(before.blocks)
    expect(after.tables, `${name}: 表の構造が変わった`).toEqual(before.tables)
    expect(after.rubies, `${name}: ルビが変わった`).toEqual(before.rubies)
    expect(after.fields, `${name}: フィールドが変わった`).toEqual(before.fields)
  })
}
