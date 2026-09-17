import { app, ipcMain } from 'electron'
import { readFile, writeFile, mkdir, readdir, rm, rename, open } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { IPC, type RecoveryEntry } from '../../shared/ipc'

/**
 * 自動保存とクラッシュ復帰。
 *
 * 未保存の変更を一定間隔で userData 配下へ退避する。
 * 正常終了時には消し、残っていれば前回が異常終了したということなので、
 * 次の起動で復元を持ちかける。
 *
 * renderer からはパスを一切渡させない。不透明な id だけを扱わせ、
 * 実際のパスは main 側でこのディレクトリの中に閉じて組み立てる。
 * そうしないと任意の場所を読み書きさせる隙になる。
 */

/** 退避の上限。増えすぎると起動のたびに読み込みが重くなる */
const MAX_ENTRIES = 8

interface Manifest {
  id: string
  originalPath: string | null
  name: string
  savedAt: number
}

function dir(): string {
  return join(app.getPath('userData'), 'recovery')
}

/** id は英数字だけに限る。パス区切りや .. を混ぜられないようにする */
function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/**
 * 退避先の id。
 *
 * 元のパスから決めるので、同じファイルを編集し続けても増えない。
 * 未保存の文書はひとつの枠を共有する。
 */
function idFor(originalPath: string | null): string {
  if (!originalPath) return 'untitled'
  let hash = 0x811c9dc5
  for (let i = 0; i < originalPath.length; i++) {
    hash ^= originalPath.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `doc-${hash.toString(16).padStart(8, '0')}`
}

async function writeAtomic(target: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${target}.tmp`
  await writeFile(tmp, bytes)
  const fh = await open(tmp, 'r+')
  try {
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmp, target)
}

async function manifests(): Promise<Manifest[]> {
  let names: string[]
  try {
    names = await readdir(dir())
  } catch {
    return []
  }

  const out: Manifest[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = await readFile(join(dir(), name), 'utf8')
      const parsed = JSON.parse(raw) as Manifest
      if (!isSafeId(parsed.id)) continue
      out.push(parsed)
    } catch {
      // 壊れた退避は無視する。復元できないだけで、編集は続けられる
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

/** 古い退避を消して上限を保つ */
async function prune(): Promise<void> {
  const all = await manifests()
  for (const entry of all.slice(MAX_ENTRIES)) {
    await rm(join(dir(), `${entry.id}.docx`), { force: true }).catch(() => undefined)
    await rm(join(dir(), `${entry.id}.json`), { force: true }).catch(() => undefined)
  }
}

export function registerRecoveryIpc(): void {
  ipcMain.handle(
    IPC.saveRecovery,
    async (_e, bytes: Uint8Array, originalPath: unknown, name: unknown) => {
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) return
      const path = typeof originalPath === 'string' && originalPath ? originalPath : null
      const id = idFor(path)
      await mkdir(dir(), { recursive: true })
      await writeAtomic(join(dir(), `${id}.docx`), bytes)
      const manifest: Manifest = {
        id,
        originalPath: path,
        name: typeof name === 'string' && name ? name : path ? basename(path) : '無題',
        savedAt: Date.now()
      }
      await writeFile(join(dir(), `${id}.json`), JSON.stringify(manifest), 'utf8')
      await prune()
    }
  )

  ipcMain.handle(IPC.listRecovery, async (): Promise<RecoveryEntry[]> => {
    return (await manifests()).map((m) => ({
      id: m.id,
      originalPath: m.originalPath,
      name: m.name,
      savedAt: m.savedAt
    }))
  })

  ipcMain.handle(IPC.readRecovery, async (_e, id: unknown): Promise<Uint8Array | null> => {
    if (!isSafeId(id)) return null
    try {
      return await readFile(join(dir(), `${id}.docx`))
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.clearRecovery, async () => {
    await rm(dir(), { recursive: true, force: true }).catch(() => undefined)
  })
}

/** 正常終了のときに呼ぶ。残っていれば異常終了だったと判断できる */
export async function clearRecoveryOnExit(): Promise<void> {
  await rm(dir(), { recursive: true, force: true }).catch(() => undefined)
}
