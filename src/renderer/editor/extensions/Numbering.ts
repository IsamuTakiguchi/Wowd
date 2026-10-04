import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NumberingTable, StyleTable } from '@core/model/types'
import { computeListMarkers, type NumberedParagraph } from '@core/numbering/markers'
import { markerCss } from '@core/numbering/markerCss'

export const numberingPluginKey = new PluginKey<DecorationSet>('wowd-numbering')

/**
 * numbering.xml をプラグインに渡すためのメタキー。
 * 文書を開くたびに setNumberingTable コマンドで差し替える。
 */
const SET_TABLE = 'wowd:setNumberingTable'
/** styles.xml。段落スタイル経由の番号 (見出しに結び付けた番号) を数えるのに要る */
const SET_STYLES = 'wowd:setNumberingStyles'

interface NumberingStorage {
  table: NumberingTable | null
  styles: StyleTable | null
}

/**
 * リストの見た目を Decoration で描くプラグイン。
 *
 * Word にリストのコンテナは存在せず、numId + ilvl を持つ兄弟段落の並びがリストなので、
 * 行頭記号は文書本体に入れず、ウィジェット Decoration として重ねるだけにする。
 * こうしないと numbering.xml がそのまま往復しない。
 */
function buildDecorations(
  doc: PMNode,
  table: NumberingTable | null,
  styles: StyleTable | null
): DecorationSet {
  if (!table || table.instances.size === 0) return DecorationSet.empty

  // 記号の計算は core と共有する。画面と PDF で番号が食い違わないようにするため。
  // 表の中の段落も文書順に数える (Word は表の内外で番号を引き継ぐ)
  const blocks: NumberedParagraph[] = []
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    blocks.push({
      numPr: (node.attrs['numPr'] as { numId: number; ilvl: number } | null) ?? null,
      pStyle: (node.attrs['pStyle'] as string | null | undefined) ?? null
    })
    positions.push(pos)
    return false
  })

  const markers = computeListMarkers(blocks, table, styles)
  const decorations: Decoration[] = []

  for (const [index, marker] of markers) {
    const pos = positions[index]
    if (pos === undefined) continue
    const css = markerCss(marker.level)
    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const span = document.createElement('span')
          span.className = 'wowd-list-marker'
          span.setAttribute('contenteditable', 'false')
          if (css.box) span.setAttribute('style', css.box)
          const glyph = css.glyph ? document.createElement('span') : span
          if (css.glyph) {
            glyph.setAttribute('style', css.glyph)
            span.appendChild(glyph)
          }
          glyph.textContent = css.suffixOutside ? marker.text : marker.text + marker.suffix
          if (!css.suffixOutside || !marker.suffix) return span
          // 右揃え・中央揃えでは、区切りは記号の箱の外 (本文の側) に置く
          const wrap = document.createElement('span')
          wrap.className = 'wowd-list-marker-wrap'
          wrap.setAttribute('contenteditable', 'false')
          wrap.appendChild(span)
          wrap.appendChild(document.createTextNode(marker.suffix))
          return wrap
        },
        { side: -1, marks: [] }
      )
    )
  }

  return DecorationSet.create(doc, decorations)
}

export const Numbering = Extension.create<Record<string, never>, NumberingStorage>({
  name: 'wowdNumbering',

  addStorage() {
    return { table: null, styles: null }
  },

  addCommands() {
    return {
      setNumberingTable:
        (table: NumberingTable | null) =>
        ({ tr, dispatch }: { tr: { setMeta: (k: string, v: unknown) => unknown }; dispatch?: unknown }) => {
          if (dispatch) tr.setMeta(SET_TABLE, table)
          return true
        },
      setNumberingStyles:
        (styles: StyleTable | null) =>
        ({ tr, dispatch }: { tr: { setMeta: (k: string, v: unknown) => unknown }; dispatch?: unknown }) => {
          if (dispatch) tr.setMeta(SET_STYLES, styles)
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
          init: (_config, state: EditorState) =>
            buildDecorations(state.doc, storage.table, storage.styles),
          apply(tr, old, _oldState, newState) {
            const incoming = tr.getMeta(SET_TABLE) as NumberingTable | null | undefined
            const incomingStyles = tr.getMeta(SET_STYLES) as StyleTable | null | undefined
            if (incoming !== undefined) storage.table = incoming
            if (incomingStyles !== undefined) storage.styles = incomingStyles
            if (incoming === undefined && incomingStyles === undefined && !tr.docChanged) return old
            return buildDecorations(newState.doc, storage.table, storage.styles)
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
