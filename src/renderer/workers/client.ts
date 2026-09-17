import type { WowdDocument } from '@core/model/types'
import type { WorkerRequest, WorkerResponse, OpenRequest, SaveRequest } from './docx.worker'

/** id は送信側で採番するので、呼び出し側は残りだけを渡す */
type RequestBody = Omit<OpenRequest, 'id'> | Omit<SaveRequest, 'id'>

/**
 * docx ワーカーへの型付きクライアント。
 * 1 つのワーカーを使い回し、id で要求と応答を突き合わせる。
 */
class DocxClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (res: WorkerResponse) => void; reject: (err: Error) => void }
  >()

  private ensure(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./docx.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
      const res = event.data
      const entry = this.pending.get(res.id)
      if (!entry) return
      this.pending.delete(res.id)
      if (res.ok) entry.resolve(res)
      else entry.reject(new Error(res.message))
    }
    worker.onerror = (event): void => {
      for (const [, entry] of this.pending) entry.reject(new Error(event.message))
      this.pending.clear()
    }
    this.worker = worker
    return worker
  }

  private send(req: RequestBody, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = this.nextId++
    const worker = this.ensure()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ ...req, id } as WorkerRequest, transfer)
    })
  }

  async open(bytes: Uint8Array, filePath: string | null): Promise<WowdDocument> {
    const res = await this.send({ kind: 'open', bytes, filePath })
    if (res.kind !== 'open') throw new Error('予期しない応答です')
    return res.document
  }

  async save(
    document: WowdDocument,
    sourceBytes: Uint8Array,
    options: { numberingChanged: boolean; commentsChanged: boolean }
  ): Promise<Uint8Array> {
    const res = await this.send({ kind: 'save', document, sourceBytes, ...options })
    if (res.kind !== 'save') throw new Error('予期しない応答です')
    return res.bytes
  }
}

export const docxClient = new DocxClient()
