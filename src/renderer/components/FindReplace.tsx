import { useMemo, useState, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { search, DEFAULT_SEARCH_OPTIONS, type SearchOptions, type SearchMatch } from '@core/search'
import { useUiStore } from '../store/ui'
import { t } from '../i18n/ja'

/**
 * 検索と置換。
 *
 * ProseMirror のドキュメント上の位置と文字列上の位置を対応づけるため、
 * textBetween で全文を取り出すときと同じ規則 (ブロック区切りを 1 文字として数える) を使う。
 */
const BLOCK_SEPARATOR = '\n'

function docText(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, BLOCK_SEPARATOR, '￼')
}

/**
 * textBetween 上のオフセットを ProseMirror の位置に直す。
 * textBetween はブロック境界に区切り 1 文字を挟むので、同じ走査で対応表を作る。
 */
function buildOffsetMap(editor: Editor): number[] {
  const map: number[] = []
  let offset = 0
  editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node, pos) => {
    if (node.isText) {
      const text = node.text ?? ''
      for (let i = 0; i < text.length; i++) map[offset++] = pos + i
      return false
    }
    if (node.isLeaf && !node.isText) {
      map[offset++] = pos
      return false
    }
    return true
  })
  // 末尾位置も引けるようにしておく
  map[offset] = editor.state.doc.content.size
  return map
}

export function FindReplace({ editor }: { editor: Editor | null }): React.JSX.Element | null {
  const open = useUiStore((s) => s.findOpen)
  const toggleFind = useUiStore((s) => s.toggleFind)

  const [needle, setNeedle] = useState('')
  const [replacement, setReplacement] = useState('')
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS)
  const [index, setIndex] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  const text = editor && open ? docText(editor) : ''
  const matches = useMemo<SearchMatch[]>(
    () => (needle ? search(text, needle, options) : []),
    [text, needle, options]
  )

  // 検索条件が変わったら現在位置と通知をリセットする。
  // effect ではなく描画時に調整する (effect で setState すると余分な再描画が 1 回増える)。
  const searchKey = `${needle}\u0000${JSON.stringify(options)}`
  const [lastKey, setLastKey] = useState(searchKey)
  if (searchKey !== lastKey) {
    setLastKey(searchKey)
    setIndex(0)
    setNotice(null)
  }

  const goTo = useCallback(
    (i: number) => {
      if (!editor || matches.length === 0) return
      const wrapped = ((i % matches.length) + matches.length) % matches.length
      const match = matches[wrapped]
      if (!match) return
      const map = buildOffsetMap(editor)
      const from = map[match.from]
      const to = map[match.to]
      if (from == null || to == null) return
      editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run()
      setIndex(wrapped)
    },
    [editor, matches]
  )

  const replaceCurrent = useCallback(() => {
    if (!editor || matches.length === 0) return
    const match = matches[index]
    if (!match) return
    const map = buildOffsetMap(editor)
    const from = map[match.from]
    const to = map[match.to]
    if (from == null || to == null) return
    editor.chain().focus().insertContentAt({ from, to }, replacement).run()
    setNotice(t.find.replacedCount(1))
  }, [editor, matches, index, replacement])

  const replaceAll = useCallback(() => {
    if (!editor || matches.length === 0) return
    const map = buildOffsetMap(editor)
    const chain = editor.chain().focus()
    // 後ろから置換する。前から置くと以降の位置がずれる
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i]!
      const from = map[match.from]
      const to = map[match.to]
      if (from == null || to == null) continue
      chain.insertContentAt({ from, to }, replacement)
    }
    chain.run()
    setNotice(t.find.replacedCount(matches.length))
  }, [editor, matches, replacement])

  if (!open) return null

  const checkbox = (
    key: keyof SearchOptions,
    label: string
  ): React.JSX.Element => (
    <label className="find-option">
      <input
        type="checkbox"
        checked={options[key]}
        onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
      />
      {label}
    </label>
  )

  return (
    <aside className="find-panel" role="dialog" aria-label={t.find.title}>
      <div className="find-header">
        <strong>{t.find.title}</strong>
        <button type="button" onClick={() => toggleFind(false)} aria-label={t.dialog.close}>
          ×
        </button>
      </div>

      <label className="find-field">
        <span>{t.find.findLabel}</span>
        <input
          value={needle}
          autoFocus
          onChange={(e) => setNeedle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goTo(index + 1)
            if (e.key === 'Escape') toggleFind(false)
          }}
        />
      </label>

      <label className="find-field">
        <span>{t.find.replaceLabel}</span>
        <input value={replacement} onChange={(e) => setReplacement(e.target.value)} />
      </label>

      <div className="find-options">
        {checkbox('matchCase', t.find.matchCase)}
        {checkbox('wholeWord', t.find.wholeWord)}
        {checkbox('regex', t.find.regex)}
        {checkbox('normalizeWidth', t.find.normalizeWidth)}
        {checkbox('normalizeKana', t.find.normalizeKana)}
      </div>

      <div className="find-actions">
        <button type="button" onClick={() => goTo(index - 1)} disabled={matches.length === 0}>
          {t.find.prev}
        </button>
        <button type="button" onClick={() => goTo(index + 1)} disabled={matches.length === 0}>
          {t.find.next}
        </button>
        <button type="button" onClick={replaceCurrent} disabled={matches.length === 0}>
          {t.find.replace}
        </button>
        <button type="button" onClick={replaceAll} disabled={matches.length === 0}>
          {t.find.replaceAll}
        </button>
      </div>

      <div className="find-status">
        {notice ??
          (needle === ''
            ? ''
            : matches.length === 0
              ? t.find.noMatch
              : t.find.matchCount(index + 1, matches.length))}
      </div>
    </aside>
  )
}
