import type { Editor } from '@tiptap/react'
import { effectiveParagraphProps } from '@core/docx/read/styles'
import { paginationKey } from '../editor/pagination/PaginationPlugin'
import { useDocumentStore } from '../store/document'

export interface HeadingEntry {
  /** 段落の位置 (段落ノードの手前) */
  pos: number
  /** 0 始まりのアウトライン レベル */
  level: number
  text: string
}

/**
 * 見出しの一覧 (ナビゲーション ウィンドウ・ジャンプ・目次と同じ考え方)。
 *
 * アウトライン レベルは、段落の直接指定 → 段落スタイル (basedOn の先を含む) の順で決める。
 * 岡口マクロのランクも、スタイルにレベルがあるので見出しとして出る。
 */
export function collectHeadings(editor: Editor): HeadingEntry[] {
  const styles = useDocumentStore.getState().document?.resources.styles ?? null
  const out: HeadingEntry[] = []
  const cache = new Map<string, number | null>()
  const styleLevel = (id: string | null): number | null => {
    if (!styles || !id) return null
    if (!cache.has(id)) cache.set(id, effectiveParagraphProps(styles, id).outlineLvl ?? null)
    return cache.get(id) ?? null
  }
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let level = (node.attrs['outlineLvl'] as number | null | undefined) ?? null
    if (level == null && node.type.name === 'heading') level = ((node.attrs['level'] as number) ?? 1) - 1
    if (level == null) level = styleLevel((node.attrs['pStyle'] as string | null) ?? null)
    if (level != null && level >= 0 && level <= 8) {
      const text = node.textContent.trim()
      if (text) out.push({ pos, level, text })
    }
    return false
  })
  return out
}

/** ページ数と、各ページの先頭の位置 */
export function pageStarts(editor: Editor): number[] {
  const state = paginationKey.getState(editor.state)
  const starts = [0]
  if (!state) return starts
  for (const d of state.decorations.find()) starts.push(d.from)
  return [...new Set(starts)].sort((a, b) => a - b)
}

/** 位置へカーソルを移し、見える所まで送る */
export function jumpTo(editor: Editor, pos: number): void {
  const size = editor.state.doc.content.size
  const target = Math.max(0, Math.min(size, pos + 1))
  editor.chain().focus().setTextSelection(target).scrollIntoView().run()
  // 段落の頭が窓の上の方に来るよう、さらに送る (scrollIntoView は端に付くだけ)
  try {
    const dom = editor.view.domAtPos(target).node as HTMLElement
    const el = dom.nodeType === Node.ELEMENT_NODE ? dom : dom.parentElement
    el?.closest('p, h1, h2, h3, h4, h5, h6')?.scrollIntoView({ block: 'start' })
  } catch {
    // 位置が解決できなくても、カーソルは移っている
  }
}
