import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useUiStore } from '../store/ui'
import { tableCommands } from '../editor/commands/table'
import { clipboard, startFormatPainter } from './actions'

interface MenuState {
  x: number
  y: number
  hasSelection: boolean
  inTable: boolean
  inLink: boolean
}

/**
 * 本文の右クリックメニュー (Word と同じ並び)。
 *
 * 選択範囲の外で右クリックしたら、その位置へカーソルを移してから出す (Word と同じ)。
 * 選択範囲の中なら選択は保つ (切り取り・コピー・書式を当てる対象にするため)。
 */
export function ContextMenu({ editor }: { editor: Editor | null }): React.JSX.Element | null {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onContext = (e: MouseEvent): void => {
      e.preventDefault()
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
      const { from, to } = editor.state.selection
      if (at && (at.pos < from || at.pos > to)) {
        editor.chain().focus().setTextSelection(at.pos).run()
      }
      const state = editor.state
      let inTable = false
      for (let d = state.selection.$from.depth; d > 0; d--) {
        if (state.selection.$from.node(d).type.name === 'tableCell' || state.selection.$from.node(d).type.name === 'tableHeader') inTable = true
      }
      setMenu({
        x: Math.min(e.clientX, window.innerWidth - 230),
        y: Math.min(e.clientY, window.innerHeight - 360),
        hasSelection: !state.selection.empty,
        inTable,
        inLink: editor.isActive('link')
      })
    }
    dom.addEventListener('contextmenu', onContext)
    return () => dom.removeEventListener('contextmenu', onContext)
  }, [editor])

  useEffect(() => {
    if (!menu) return
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', () => setMenu(null), { once: true })
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [menu])

  if (!menu || !editor) return null
  const ui = useUiStore.getState()
  const run = (fn: () => void) => (): void => {
    setMenu(null)
    fn()
  }
  const table = tableCommands(editor)

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="編集"
      style={{ left: menu.x, top: menu.y }}
      data-testid="context-menu"
      onMouseDown={(e) => e.preventDefault()}
    >
      <Item label="切り取り" keys="Ctrl+X" disabled={!menu.hasSelection} onClick={run(() => void clipboard(editor, 'cut'))} />
      <Item label="コピー" keys="Ctrl+C" disabled={!menu.hasSelection} onClick={run(() => void clipboard(editor, 'copy'))} />
      <Item label="貼り付け" keys="Ctrl+V" onClick={run(() => void clipboard(editor, 'paste'))} />
      <hr />
      <Item label="書式のコピー" keys="Ctrl+Shift+C" onClick={run(() => startFormatPainter(editor))} />
      <Item label="段落…" onClick={run(() => ui.openDialog('paragraph'))} testId="context-paragraph" />
      <Item label={menu.inLink ? 'リンクの編集…' : 'リンク…'} keys="Ctrl+K" onClick={run(() => ui.openDialog('link'))} />
      {menu.inLink && (
        <Item label="リンクの解除" onClick={run(() => editor.chain().focus().extendMarkRange('link').unsetMark('link').run())} />
      )}
      <Item
        label="新しいコメント"
        disabled={!menu.hasSelection}
        onClick={run(() => {
          ui.toggleComments(true)
          setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-testid="comment-draft"]')?.focus(), 50)
        })}
      />
      {menu.inTable && (
        <>
          <hr />
          <Item label="上に行を挿入" onClick={run(table.addRowBefore)} />
          <Item label="下に行を挿入" onClick={run(table.addRowAfter)} />
          <Item label="左に列を挿入" onClick={run(table.addColumnBefore)} />
          <Item label="右に列を挿入" onClick={run(table.addColumnAfter)} />
          <Item label="行の削除" onClick={run(table.deleteRow)} />
          <Item label="列の削除" onClick={run(table.deleteColumn)} />
          <Item label="セルの結合" onClick={run(table.mergeCells)} />
          <Item label="セルの分割" onClick={run(table.splitCell)} />
        </>
      )}
      <hr />
      <Item label="記号と特殊文字…" onClick={run(() => ui.openDialog('symbol'))} />
    </div>
  )
}

function Item({
  label,
  keys,
  disabled = false,
  onClick,
  testId
}: {
  label: string
  keys?: string
  disabled?: boolean
  onClick: () => void
  testId?: string
}): React.JSX.Element {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} data-testid={testId}>
      <span>{label}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  )
}
