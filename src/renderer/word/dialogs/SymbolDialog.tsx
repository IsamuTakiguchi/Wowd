import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog } from '../../components/dialogs/Dialog'

/** よく使う記号。法律文書・公用文で使うものを先に置く */
const GROUPS: { label: string; chars: string }[] = [
  { label: 'よく使う', chars: '※〒〃々〆〇・…‥―－～￥℃㎡§¶†‡' },
  { label: '括弧', chars: '「」『』（）〔〕［］｛｝〈〉《》【】〖〗' },
  { label: '丸数字', chars: '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽' },
  { label: 'ローマ数字', chars: 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ' },
  { label: '図形', chars: '○●◎◇◆□■△▲▽▼☆★♪✓✔✕' },
  { label: '矢印', chars: '→←↑↓⇒⇔↔↗↘' },
  { label: '数学', chars: '±×÷＝≠≦≧＜＞∞∴∵√∫∑≒≡⊂⊃∪∩∈' },
  { label: '単位・略号', chars: '㎜㎝㎞㎎㎏㏄㍉㌔㌢㍍㌘㌧㌃㌶㍑㍗㌍㌦㌣㌫㍊㌻㈱㈲㈹㍾㍽㍼㍻㊤㊥㊦㊧㊨№℡' }
]

const RECENT_KEY = 'wowd.recentSymbols'

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 16) : []
  } catch {
    return []
  }
}

/** 記号と特殊文字 */
export function SymbolDialog({ editor, onClose }: { editor: Editor; onClose: () => void }): React.JSX.Element {
  const [recent, setRecent] = useState(loadRecent)
  const insert = (ch: string): void => {
    editor.chain().focus().insertContent(ch).run()
    const next = [ch, ...recent.filter((c) => c !== ch)].slice(0, 16)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      // 覚えられなくても挿入はできている
    }
  }
  const row = (label: string, chars: string[]): React.JSX.Element => (
    <div className="symbol-group" key={label}>
      <div className="symbol-label">{label}</div>
      <div className="symbol-grid">
        {chars.map((ch) => (
          <button key={ch} type="button" title={`U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`} data-testid={`symbol-${ch}`} onClick={() => insert(ch)}>
            {ch}
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <Dialog title="記号と特殊文字" open onClose={onClose} width={520}>
      <p className="wowd-dialog-note">押すとカーソルの位置に入ります。続けて何文字でも入れられます。</p>
      {recent.length > 0 && row('最近使った記号', recent)}
      {GROUPS.map((g) => row(g.label, Array.from(g.chars)))}
    </Dialog>
  )
}
