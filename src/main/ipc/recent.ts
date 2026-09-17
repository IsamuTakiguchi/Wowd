import { app, ipcMain } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { IPC, type RecentEntry } from '../../shared/ipc'

const MAX_RECENT = 12

function storePath(): string {
  return join(app.getPath('userData'), 'recent.json')
}

async function load(): Promise<RecentEntry[]> {
  try {
    const raw = await readFile(storePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is RecentEntry =>
        typeof e === 'object' && e !== null && typeof (e as RecentEntry).path === 'string'
    )
  } catch {
    return []
  }
}

async function save(entries: RecentEntry[]): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(storePath(), JSON.stringify(entries, null, 2), 'utf8')
}

/** メニュー再構築のためのフック。main/index.ts が登録する */
let onChange: (() => void) | null = null
export function setRecentChangeHandler(cb: () => void): void {
  onChange = cb
}

export async function getRecent(): Promise<RecentEntry[]> {
  return load()
}

export function registerRecentIpc(): void {
  ipcMain.handle(IPC.getRecent, () => load())

  ipcMain.handle(IPC.addRecent, async (_e, p: string) => {
    if (typeof p !== 'string' || !p) return
    const entries = await load()
    const next = [
      { path: p, name: basename(p), openedAt: Date.now() },
      ...entries.filter((e) => e.path !== p)
    ].slice(0, MAX_RECENT)
    await save(next)
    app.addRecentDocument(p)
    onChange?.()
  })

  ipcMain.handle(IPC.clearRecent, async () => {
    await save([])
    app.clearRecentDocuments()
    onChange?.()
  })
}
