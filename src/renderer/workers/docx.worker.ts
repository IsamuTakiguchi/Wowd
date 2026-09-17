/**
 * .docx の解析と直列化を担うワーカー。
 *
 * main プロセスではなくレンダラ側のワーカーで動かす理由:
 *  - 解析結果はどのみちレンダラに必要。main で解析するとプロセス間の
 *    structured clone が余計に 1 回増える。
 *  - main が固まるとメニューバーもウィンドウ操作も全部固まる。ワーカーなら何も固まらない。
 *  - DOM 非依存の純粋コードなので vitest から直接テストできる。
 */
import { readDocx } from '@core/docx/read'
import { writeDocx } from '@core/docx/write'
import type { WowdDocument } from '@core/model/types'
import type { DocxPackage } from '@core/docx/package'
import { openPackage } from '@core/docx/package'

export interface OpenRequest {
  kind: 'open'
  id: number
  bytes: Uint8Array
  filePath: string | null
}

export interface SaveRequest {
  kind: 'save'
  id: number
  /** 元パッケージを再構築するための最後に読んだバイト列 */
  sourceBytes: Uint8Array
  document: WowdDocument
  numberingChanged: boolean
  commentsChanged: boolean
  headersChanged: boolean
  tocChanged: boolean
}

export type WorkerRequest = OpenRequest | SaveRequest

export type WorkerResponse =
  | { kind: 'open'; id: number; ok: true; document: WowdDocument }
  | { kind: 'save'; id: number; ok: true; bytes: Uint8Array }
  | { kind: 'error'; id: number; ok: false; message: string }

/** 開いたパッケージを id ごとに保持し、保存時に再利用する */
const packages = new Map<string, DocxPackage>()

function handle(req: WorkerRequest): WorkerResponse {
  if (req.kind === 'open') {
    const result = readDocx(req.bytes, req.filePath)
    packages.set(req.filePath ?? `__unsaved_${req.id}`, result.pkg)
    const document: WowdDocument = {
      filePath: result.filePath,
      doc: result.doc,
      resources: result.resources,
      unsupported: result.unsupported
    }
    return { kind: 'open', id: req.id, ok: true, document }
  }

  // 保存は必ず「開いたときのパッケージ」から始める。
  // これが未対応パートをバイト単位で保つ唯一の方法。
  const pkg = openPackage(req.sourceBytes)
  const bytes = writeDocx(req.document, pkg, {
    numberingChanged: req.numberingChanged,
    commentsChanged: req.commentsChanged,
    headersChanged: req.headersChanged,
    tocChanged: req.tocChanged
  })
  return { kind: 'save', id: req.id, ok: true, bytes }
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const req = event.data
  try {
    const res = handle(req)
    // メディアのバイト列はコピーせず転送する
    const transfer = res.kind === 'save' ? [res.bytes.buffer] : []
    ;(self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage(
      res,
      transfer as Transferable[]
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ;(self as unknown as { postMessage: (m: unknown) => void }).postMessage({
      kind: 'error',
      id: req.id,
      ok: false,
      message
    })
  }
}
