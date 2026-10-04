import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { RunProps } from '@core/model/types'
import { scaleMarginEm } from '@core/css/runCss'

const key = new PluginKey<DecorationSet>('wowd-run-scale')

/**
 * 文字の横幅 (w:w) を縮めた文字のあとを詰める。
 *
 * 横幅はマークの CSS (scaleX) で縮めるが、それは見た目だけで、行の中の幅は元のまま残る。
 * 詰める量は文字列で決まるので、マークの描画 (文字列を知らない) では出せない。
 * 文字列を知っているここで、負の余白を Decoration として足す。
 * 「(1)」の括弧を半分の幅にして全角 1 字に収める (岡口マクロの全角1文字入力) のに要る。
 */
function build(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const mark = node.marks.find((m) => m.type.name === 'textStyle')
    const w = (mark?.attrs['runProps'] as RunProps | null | undefined)?.w
    const shrink = scaleMarginEm(node.text, w)
    if (shrink == null) return false
    decorations.push(
      Decoration.inline(pos, pos + node.nodeSize, { style: `margin-right:${shrink}em` })
    )
    return false
  })
  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty
}

export const RunScale = Extension.create({
  name: 'wowdRunScale',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_c, state) => build(state.doc),
          apply: (tr, old, _o, state) => (tr.docChanged ? build(state.doc) : old)
        },
        props: {
          decorations: (state) => key.getState(state) ?? DecorationSet.empty
        }
      })
    ]
  }
})
