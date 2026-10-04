import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Dialog } from '../../components/dialogs/Dialog'
import { LATIN_FONTS, type LatinFont } from '@core/okaguchi/pageFormat'
import { applyPostSet, type PostSetScope } from '../rank'
import { applyCourtFormat } from '../format'
import { useUiStore } from '../../store/ui'
import { Check, Choice } from './common'

/**
 * 連番等事後設定 (Alt+J)。手で打った見出し符号を、連番ランク (自動の番号) に置き換える。
 */
export function PostSetDialog({ editor, onClose }: { editor: Editor | null; onClose: () => void }): React.JSX.Element {
  // 複数の段落を選んでいたら、その段落だけが対象 (元のフォームと同じ)
  const multi = (() => {
    if (!editor) return false
    const { $from, $to } = editor.state.selection
    return !$from.sameParent($to)
  })()
  const [scope, setScope] = useState<PostSetScope>(multi ? 'selection' : 'all')
  const [bodyIndent, setBodyIndent] = useState(true)
  const [court, setCourt] = useState(false)
  const [latin, setLatin] = useState<LatinFont>('Times New Roman')
  const [lineNumbers, setLineNumbers] = useState(false)

  const submit = (): void => {
    if (!editor) return
    if (court) applyCourtFormat(latin, lineNumbers)
    const result = applyPostSet(editor, { scope, bodyIndent })
    if (result) {
      useUiStore
        .getState()
        .notify(
          result.headings + result.bodies > 0
            ? `見出し ${result.headings} か所を連番ランクにし、本文 ${result.bodies} か所に字下げを付けました`
            : '見出し符号は見つかりませんでした (第１　・１　・（１）・ア　・（ア）・ａ　・（ａ）・①　の形を探します)'
        )
    }
    onClose()
  }

  return (
    <Dialog title="見出し符号等を事後設定します" open onClose={onClose} onSubmit={submit} width={500}>
      <p className="wowd-dialog-note">
        段落の先頭に手で打った「第１」「１」「（１）」「ア」「（ア）」「ａ」「（ａ）」「①」を見つけ、
        連番ランク (自動の番号) に置き換えます。番号は順番どおりのものだけを見出しとみなします
        (「１」は振り直し)。半角で打ったものも見つけます。
      </p>
      <Choice
        legend="範囲"
        name="okaguchi-postset-scope"
        value={scope}
        onChange={setScope}
        options={
          multi
            ? [{ value: 'selection', label: '選んだ段落' }]
            : [
                { value: 'all', label: '文書全体' },
                { value: 'fromCursor', label: 'カーソル位置より下' }
              ]
        }
      />
      <Check
        label="見出し符号のない段落もインデントを設定する"
        checked={bodyIndent}
        onChange={setBodyIndent}
        testId="okaguchi-postset-body"
      />
      <Check label="裁判所書式へ変更する" checked={court} onChange={setCourt} />
      {court && (
        <>
          <Choice
            legend="半角英数字の標準フォント"
            name="okaguchi-postset-latin"
            value={latin}
            onChange={setLatin}
            options={LATIN_FONTS.map((f) => ({ value: f, label: f }))}
          />
          <Check label="行番号を挿入する" checked={lineNumbers} onChange={setLineNumbers} />
        </>
      )}
    </Dialog>
  )
}
