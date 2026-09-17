import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import { buildTrackingTransaction, isoNow, nextRevisionId } from './track'
import {
  applyAllRevisions,
  applyRevisions,
  findRevision,
  revisionAt,
  type RevisionAction
} from './apply'

export type RevisionDisplay = 'all' | 'final' | 'original'

export interface TrackChangesStorage {
  /** 記録中かどうか */
  enabled: boolean
  /** 変更に付ける著者名 */
  author: string
  /** 表示モード */
  display: RevisionDisplay
}

export const trackChangesKey = new PluginKey('wowd-track-changes')

/** 変更履歴の書き換えで生まれたトランザクションの印。二重に追跡しない */
const TRACKED = 'wowdTracked'

/**
 * 変更履歴を記録しないトランザクションかどうか。
 *
 * 取り消し・やり直しを追跡すると、取り消した編集がまた新しい変更として
 * 記録され、元に戻せなくなる。履歴プラグインが立てる印で見分ける。
 */
function isSkipped(tr: Transaction): boolean {
  if (tr.getMeta(TRACKED)) return true
  // PluginKey('history') の meta キー。undo / redo はこれを持つ
  if (tr.getMeta('history$')) return true
  return false
}

export const TrackChanges = Extension.create<Record<string, never>, TrackChangesStorage>({
  name: 'trackChanges',

  addStorage() {
    return { enabled: false, author: 'Wowd', display: 'all' }
  },

  addCommands() {
    const commands = {
      setTrackChanges:
        (enabled: boolean) =>
        (): boolean => {
          this.storage.enabled = enabled
          return true
        },
      setRevisionAuthor:
        (author: string) =>
        (): boolean => {
          this.storage.author = author
          return true
        },
      setRevisionDisplay:
        (display: RevisionDisplay) =>
        (): boolean => {
          this.storage.display = display
          return true
        },
      applyRevisionAt:
        (action: RevisionAction) =>
        ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
          const { from, to } = state.selection
          // 折りたたんだカーソルなら、その位置にかかる変更ひとつを対象にする
          const range = from === to ? (revisionAt(state.doc, from) ?? { from, to }) : { from, to }
          const tr = applyRevisions(state, action, range.from, range.to)
          if (!tr) return false
          dispatch?.(tr.setMeta(TRACKED, true))
          return true
        },
      applyAllRevisions:
        (action: RevisionAction) =>
        ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
          const tr = applyAllRevisions(state, action)
          if (!tr) return false
          dispatch?.(tr.setMeta(TRACKED, true))
          return true
        },
      gotoRevision:
        (direction: 1 | -1) =>
        ({
          state,
          dispatch,
          view
        }: {
          state: EditorState
          dispatch?: (tr: Transaction) => void
          view?: EditorView
        }) => {
          const found = findRevision(state.doc, state.selection.from, direction)
          if (!found) return false
          const tr = state.tr.setSelection(TextSelection.create(state.doc, found.from, found.to))
          dispatch?.(tr.scrollIntoView())
          // 選んだ範囲が画面に出るように、ここで本文へフォーカスを戻す。
          // チェーンの focus() を先に挟むと元の選択に戻されてしまう
          view?.focus()
          return true
        }
    }
    return commands as never
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin({
        key: trackChangesKey,
        appendTransaction(trs, oldState, newState) {
          if (!storage.enabled) return null
          if (!trs.some((tr) => tr.docChanged)) return null
          if (trs.some(isSkipped)) return null

          const maps = trs.flatMap((tr) => tr.mapping.maps)
          const tr = buildTrackingTransaction(oldState, newState, maps, {
            author: storage.author,
            nextId: () => nextRevisionId(newState.doc),
            now: isoNow
          })
          // addToHistory は落とさない。落とすと「元に戻す」で元の編集だけが戻り、
          // 書き換えたぶんが取り残される。同じ時刻に届くので履歴側で 1 つにまとまる
          return tr ? tr.setMeta(TRACKED, true) : null
        }
      })
    ]
  }
})
