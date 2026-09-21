/**
 * IndexedDB の薄い包み。
 *
 * ブラウザ版には Electron の userData に当たる置き場が無い。
 * 最近使ったファイルと自動保存の控えはここに置く。
 * localStorage はバイト列を置くには小さすぎる (数 MB で頭打ち)。
 *
 * ライブラリ (idb など) は入れない。使うのは get / put / getAll / delete / clear
 * だけで、そのために依存を増やす理由が無い。
 */

const DB_NAME = 'wowd'
const DB_VERSION = 1

export type StoreName = 'recent' | 'recovery'

let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('この環境では IndexedDB が使えません'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('recent')) db.createObjectStore('recent', { keyPath: 'name' })
      if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けませんでした'))
    req.onblocked = () => reject(new Error('IndexedDB が他のタブに使われています'))
  })
  // 失敗したら次回また開き直せるようにする
  opening.catch(() => {
    opening = null
  })
  return opening
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB の操作に失敗しました'))
  })
}

async function store(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await open()
  return db.transaction(name, mode).objectStore(name)
}

export async function idbGet<T>(name: StoreName, key: string): Promise<T | undefined> {
  return request((await store(name, 'readonly')).get(key)) as Promise<T | undefined>
}

export async function idbGetAll<T>(name: StoreName): Promise<T[]> {
  return request((await store(name, 'readonly')).getAll()) as Promise<T[]>
}

export async function idbPut<T>(name: StoreName, value: T): Promise<void> {
  await request((await store(name, 'readwrite')).put(value))
}

export async function idbDelete(name: StoreName, key: string): Promise<void> {
  await request((await store(name, 'readwrite')).delete(key))
}

export async function idbClear(name: StoreName): Promise<void> {
  await request((await store(name, 'readwrite')).clear())
}
