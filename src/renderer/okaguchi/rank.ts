import type { Editor } from '@tiptap/react'
import {
  setupRanks,
  findRankStyleIds,
  rankBaseNumId,
  createRestartNum,
  planHalfWidthFix,
  type RankStyleIds
} from '@core/okaguchi/rank'
import { useDocumentStore } from '../store/document'
import { useUiStore } from '../store/ui'
import { rankTransaction, collectParagraphs, setNumPrTransaction } from './rankCommands'

/** 番号定義が変わったことをエディタ (行頭記号の描画) とストア (保存) に伝える */
function numberingChanged(editor: Editor): void {
  const store = useDocumentStore.getState()
  const table = store.document?.resources.numbering ?? null
  ;(editor.commands as unknown as { setNumberingTable: (t: unknown) => void }).setNumberingTable(table)
  store.markNumberingChanged()
}

/**
 * 連番ランク設定 (Alt+R)。スタイルと番号定義を作る (作り直す)。
 *
 * @param quiet 知らせを出さない (ランクN を押したときに自動で設定する場合)
 */
export function setupRankStyles(editor: Editor, quiet = false): RankStyleIds | null {
  const store = useDocumentStore.getState()
  const document = store.document
  if (!document) return null
  const { resources } = document
  const result = setupRanks(resources.styles, resources.numbering, resources.sections[0])
  store.updateStyles(result.styles)
  numberingChanged(editor)
  if (!quiet) {
    useUiStore
      .getState()
      .notify('連番ランクを設定しました。標準のフォントや 1 行の文字数を変えたら、もう一度設定してください')
  }
  return result.ids
}

/** 設定済みならその ID、まだなら設定してから返す (元のマクロは未設定だと誤動作した) */
function ensureRanks(editor: Editor): RankStyleIds | null {
  const document = useDocumentStore.getState().document
  if (!document) return null
  const { styles, numbering } = document.resources
  const ids = findRankStyleIds(styles)
  if (ids && rankBaseNumId(styles, ids, numbering) != null) return ids
  const created = setupRankStyles(editor, true)
  if (created) useUiStore.getState().notify('連番ランクのスタイルを用意しました')
  return created
}

/** ランクN (Alt+N)。ランクN ⇔ 本文N の切り替え */
export function applyRank(editor: Editor, n: number): boolean {
  const ids = ensureRanks(editor)
  if (!ids) return false
  const tr = rankTransaction(editor.state, n, ids)
  if (!tr) return false
  editor.view.dispatch(tr)
  useDocumentStore.getState().markDirty()
  editor.commands.focus()
  return true
}

/** 打直 (Alt+Shift+N)。ランクN にして、番号を 1 から振り直す */
export function restartRank(editor: Editor, n: number): boolean {
  const ids = ensureRanks(editor)
  const document = useDocumentStore.getState().document
  if (!ids || !document) return false
  const { styles, numbering } = document.resources
  const base = rankBaseNumId(styles, ids, numbering)
  if (base == null) return false
  const numId = createRestartNum(numbering, base, n - 1)
  const tr = rankTransaction(editor.state, n, ids, { restartNumPr: { numId, ilvl: n - 1 } })
  if (!tr) {
    numbering.instances.delete(numId)
    return false
  }
  editor.view.dispatch(tr)
  numberingChanged(editor)
  editor.commands.focus()
  return true
}

/** 連番ランク修正 (Alt+Shift+R)。ランク１・２の 10 以上を半角にする */
export function fixRankHalfWidth(editor: Editor): boolean {
  const document = useDocumentStore.getState().document
  if (!document) return false
  const { styles, numbering } = document.resources
  const ids = findRankStyleIds(styles)
  if (!ids) {
    useUiStore.getState().notify('連番ランクがまだ設定されていません (Alt+R で設定します)')
    return false
  }
  const paragraphs = collectParagraphs(editor.state.doc)
  const plan = planHalfWidthFix(paragraphs, numbering, styles, ids)
  const byPos = new Map<number, { numId: number; ilvl: number } | null>()
  for (const [index, numPr] of plan) {
    const p = paragraphs[index]
    if (p) byPos.set(p.pos, numPr)
  }
  const tr = setNumPrTransaction(editor.state, byPos)
  if (tr) editor.view.dispatch(tr)
  numberingChanged(editor)
  const count = [...plan.values()].filter((v) => v !== null).length
  useUiStore
    .getState()
    .notify(count > 0 ? `2 桁以上の見出し符号 ${count} か所を半角にしました` : '直す見出し符号はありませんでした')
  return true
}
