import type { Editor } from '@tiptap/react'
import { Dialog } from '../../components/dialogs/Dialog'
import { useUiStore } from '../../store/ui'

/** 単語の数え方。英数字のまとまりは 1 語、日本語は 1 字を 1 語 (Word の日本語版と同じ考え方) */
export function countWords(text: string): number {
  let n = 0
  for (const _ of text.matchAll(/[A-Za-z0-9À-ɏ'’-]+|[^\sA-Za-z0-9À-ɏ'’-]/g)) n++
  return n
}

/** 文字カウント (ステータスバーの文字数を押すと開く。Word と同じ) */
export function WordCountDialog({ editor, onClose }: { editor: Editor; onClose: () => void }): React.JSX.Element {
  const pageCount = useUiStore((s) => s.pageCount)
  const { from, to, empty } = editor.state.selection
  const text = empty ? editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n') : editor.state.doc.textBetween(from, to, '\n')
  const body = text.replace(/\n/g, '')
  let paragraphs = 0
  editor.state.doc.nodesBetween(empty ? 0 : from, empty ? editor.state.doc.content.size : to, (node) => {
    if (node.isTextblock) {
      if (node.textContent.trim()) paragraphs++
      return false
    }
    return true
  })
  const rows: [string, number][] = [
    ['ページ数', pageCount],
    ['単語数', countWords(body)],
    ['文字数 (スペースを含めない)', [...body.replace(/\s/g, '')].length],
    ['文字数 (スペースを含める)', [...body].length],
    ['段落数', paragraphs]
  ]
  return (
    <Dialog title="文字カウント" open onClose={onClose} width={360}>
      <p className="wowd-dialog-note">{empty ? '文書全体' : '選択している範囲'}</p>
      <table className="wordcount-table" data-testid="wordcount">
        <tbody>
          {rows.filter(([label]) => empty || label !== 'ページ数').map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value.toLocaleString('ja-JP')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  )
}
