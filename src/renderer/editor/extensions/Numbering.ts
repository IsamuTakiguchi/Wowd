import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NumberingTable, NumberingLevel, ParagraphIndent } from '@core/model/types'
import { computeListMarkers } from '@core/numbering/markers'
import { twipToPt } from '@shared/units'

export const numberingPluginKey = new PluginKey<DecorationSet>('wowd-numbering')

/**
 * numbering.xml をプラグインに渡すためのメタキー。
 * 文書を開くたびに setNumberingTable コマンドで差し替える。
 */
const SET_TABLE = 'wowd:setNumberingTable'

interface NumberingStorage {
  table: NumberingTable | null
}

/**
 * リストの見た目を Decoration で描くプラグイン。
 *
 * Word にリストのコンテナは存在せず、numId + ilvl を持つ兄弟段落の並びがリストなので、
 * 行頭記号は文書本体に入れず、ウィジェット Decoration として重ねるだけにする。
 * こうしないと numbering.xml がそのまま往復しない。
 */
function buildDecorations(doc: PMNode, table: NumberingTable | null): DecorationSet {
  if (!table || table.instances.size === 0) return DecorationSet.empty

  // 記号の計算は core と共有する。画面と PDF で番号が食い違わないようにするため
  const blocks: { numPr: { numId: number; ilvl: number } | null }[] = []
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (!node.isBlock) return true
    if (node.type.name === 'table' || node.type.name === 'tableCell') return true
    blocks.push({ numPr: (node.attrs['numPr'] as { numId: number; ilvl: number } | null) ?? null })
    positions.push(pos)
    return false
  })

  const markers = computeListMarkers(blocks, table)
  const decorations: Decoration[] = []

  for (const [index, marker] of markers) {
    const pos = positions[index]
    if (pos === undefined) continue
    const style = markerStyle(marker.level)
    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const span = document.createElement('span')
          span.className = 'wowd-list-marker'
          span.setAttribute('contenteditable', 'false')
          span.textContent = marker.text + marker.suffix
          if (style) span.setAttribute('style', style)
          return span
        },
        { side: -1, marks: [] }
      )
    )
  }

  return DecorationSet.create(doc, decorations)
}

/**
 * 行頭記号の位置は w:ind のぶら下げ量で決まる。
 * 段落本体は margin-inline-start ぶん右に寄っているので、
 * 記号はそこから hanging ぶん左に出す。
 */
function markerStyle(level: NumberingLevel): string {
  const ind = (level.pPr?.ind ?? null) as ParagraphIndent | null
  if (!ind) return ''
  const hanging =
    ind.hangingChars != null ? `${ind.hangingChars / 100}em` : ind.hanging != null ? `${twipToPt(ind.hanging)}pt` : null
  if (!hanging) return ''
  return `display:inline-block;width:${hanging};margin-inline-start:-${hanging}`
}

export const Numbering = Extension.create<Record<string, never>, NumberingStorage>({
  name: 'wowdNumbering',

  addStorage() {
    return { table: null }
  },

  addCommands() {
    return {
      setNumberingTable:
        (table: NumberingTable | null) =>
        ({ tr, dispatch }: { tr: { setMeta: (k: string, v: unknown) => unknown }; dispatch?: unknown }) => {
          if (dispatch) tr.setMeta(SET_TABLE, table)
          return true
        }
    } as never
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin<DecorationSet>({
        key: numberingPluginKey,
        state: {
          init: (_config, state: EditorState) => buildDecorations(state.doc, storage.table),
          apply(tr, old, _oldState, newState) {
            const incoming = tr.getMeta(SET_TABLE) as NumberingTable | null | undefined
            if (incoming !== undefined) {
              storage.table = incoming
              return buildDecorations(newState.doc, storage.table)
            }
            if (!tr.docChanged) return old
            return buildDecorations(newState.doc, storage.table)
          }
        },
        props: {
          decorations(state) {
            return numberingPluginKey.getState(state) ?? DecorationSet.empty
          }
        }
      })
    ]
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => changeLevel(this.editor, +1),
      'Shift-Tab': () => changeLevel(this.editor, -1)
    }
  }
})

/** リスト段落の上で Tab / Shift-Tab を押したときだけレベルを増減する */
function changeLevel(
  editor: { state: EditorState; commands: { updateAttributes: (n: string, a: object) => boolean } },
  delta: number
): boolean {
  const { $from } = editor.state.selection
  const node = $from.parent
  const numPr = node.attrs['numPr'] as { numId: number; ilvl: number } | null
  if (!numPr) return false
  const next = Math.min(8, Math.max(0, numPr.ilvl + delta))
  if (next === numPr.ilvl) return true
  return editor.commands.updateAttributes(node.type.name, {
    numPr: { numId: numPr.numId, ilvl: next }
  })
}
