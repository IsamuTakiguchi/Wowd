import type { Editor } from '@tiptap/react'
import type { WowdDocument, BlockNode } from '@core/model/types'
import { buildPrintHtml, type PrintPage } from '@core/css/printHtml'
import { toWowdDoc } from '../editor/serialize/toWowdDoc'
import { paginationKey } from '../editor/pagination/PaginationPlugin'
import { twipToMm } from '@shared/units'

/**
 * 画面のページ分割結果をそのまま印刷用 HTML に写して PDF にする。
 *
 * ページ分割をやり直さないのが肝。同じ改ページ位置を使うので、
 * 「画面の見た目と PDF が一致する」ことが結果的にではなく構造的に保証される。
 */
export interface PrintPayload {
  html: string
  papers: { widthMm: number; heightMm: number }[]
  pageCount: number
  defaultName: string
}

/**
 * 印刷用の一式を組み立てる。
 * いま開いているエディタと文書は登録済みのものを使う。
 */
export function buildPrintPayload(
  editor: Editor,
  document_: WowdDocument,
  fileName: string
): PrintPayload {
  const pages = slicePages(editor, document_)
  const html = buildPrintHtml({
    pages,
    styles: document_.resources.styles,
    headers: document_.resources.headers,
    footers: document_.resources.footers,
    mediaDataUrls: mediaDataUrls(document_),
    numbering: document_.resources.numbering,
    title: fileName
  })

  return {
    html,
    papers: pages.map((page) => ({
      widthMm: twipToMm(page.section.pgSz.w),
      heightMm: twipToMm(page.section.pgSz.h)
    })),
    pageCount: pages.length,
    defaultName: fileName.replace(/\.docx$/i, '') + '.pdf'
  }
}

/** いま開いているエディタと文書。E2E から印刷を叩けるようにするために保持する */
let currentEditor: Editor | null = null
let currentDocument: WowdDocument | null = null
let currentName = '文書'

export function registerPrintSource(
  editor: Editor | null,
  document_: WowdDocument | null,
  fileName: string
): void {
  currentEditor = editor
  currentDocument = document_
  currentName = fileName
}

export function getPrintPayload(): PrintPayload | null {
  if (!currentEditor || !currentDocument) return null
  return buildPrintPayload(currentEditor, currentDocument, currentName)
}

export async function exportPdf(
  editor: Editor,
  document_: WowdDocument,
  fileName: string
): Promise<{ path: string | null; pageCount: number }> {
  const payload = buildPrintPayload(editor, document_, fileName)
  return window.wowd.printToPdf({ ...payload, targetPath: null })
}

/**
 * ページ分割プラグインが決めた改ページ位置で、本文をページごとに切り分ける。
 *
 * プラグインはスペーサーを「そのブロックの手前」に置いているので、
 * スペーサーの位置 = そのブロックからが次ページ、と読める。
 */
export function slicePages(editor: Editor, document_: WowdDocument): PrintPage[] {
  const doc = toWowdDoc(editor.getJSON() as never)
  const section = document_.resources.sections[0]
  if (!section) return []

  const breakPositions = breakBlockIndices(editor)
  const start = section.pgNumType?.start ?? 1

  const pages: PrintPage[] = []
  let current: BlockNode[] = []

  doc.content.forEach((block, index) => {
    if (breakPositions.has(index) && current.length > 0) {
      pages.push({ displayNumber: start + pages.length, section, blocks: current })
      current = []
    }
    current.push(block)
  })
  pages.push({ displayNumber: start + pages.length, section, blocks: current })

  return pages
}

/** スペーサーの位置から「そこから次ページ」になるブロック番号を求める */
function breakBlockIndices(editor: Editor): Set<number> {
  const state = paginationKey.getState(editor.state)
  const result = new Set<number>()
  if (!state) return result

  const positions = state.decorations
    .find()
    .map((decoration) => decoration.from)
    .sort((a, b) => a - b)

  for (const pos of positions) {
    try {
      const index = editor.state.doc.resolve(pos).index(0)
      result.add(index)
    } catch {
      // 位置が解決できないものは飛ばす。1 つ落としても崩れるのはその改ページだけ
    }
  }
  return result
}

/**
 * 画像を data URL にする。
 * 印刷用文書は外部参照を持たない自己完結した HTML でなければならない。
 */
function mediaDataUrls(document_: WowdDocument): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, entry] of document_.resources.media) {
    out.set(key, `data:${entry.contentType};base64,${toBase64(entry.bytes)}`)
  }
  return out
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
