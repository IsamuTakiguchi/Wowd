import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Justification, ParagraphIndent, ParagraphSpacing } from '@core/model/types'
import { Dialog } from '../../components/dialogs/Dialog'
import { recordParaFormatChange } from '../../editor/track/formatRevision'
import { twipToPt } from '@shared/units'

/**
 * 段落の設定 (Word の「段落」ダイアログ)。
 *
 * インデントは字、段落の前後は行で指定する (日本語版 Word の既定の単位)。
 * Word と同じく、**触った項目だけ**を選んだ段落すべてに当てる。
 * 触っていない項目は段落ごとの値のまま残る。
 */

type FirstLine = 'none' | 'indent' | 'hanging'
type LineMode = 'single' | 'onePointFive' | 'double' | 'atLeast' | 'exact' | 'multiple'

interface Values {
  jc: Justification | ''
  outline: string
  left: string
  right: string
  firstLine: FirstLine
  firstWidth: string
  before: string
  after: string
  lineMode: LineMode
  lineValue: string
}

/** twip → 字 (文字単位の指定が無いときの目安。10.5pt の字で数える) */
const twipToChars = (twip: number, sizePt: number): number => Math.round((twipToPt(twip) / sizePt) * 10) / 10

function initial(editor: Editor, sizePt: number): Values {
  const attrs = editor.state.selection.$from.parent.attrs as {
    jc?: Justification | null
    outlineLvl?: number | null
    ind?: ParagraphIndent | null
    spacing?: ParagraphSpacing | null
  }
  const ind = attrs.ind ?? {}
  const sp = attrs.spacing ?? {}
  const chars = (c: number | undefined, t: number | undefined): string =>
    c != null ? String(c / 100) : t != null ? String(twipToChars(t, sizePt)) : '0'
  const firstLine: FirstLine =
    ind.hangingChars != null || ind.hanging != null
      ? 'hanging'
      : (ind.firstLineChars ?? ind.firstLine ?? 0) !== 0
        ? 'indent'
        : 'none'
  const lines = (l: number | undefined, t: number | undefined): string =>
    l != null ? String(l / 100) : t != null ? String(Math.round((twipToPt(t) / (sizePt * 1.5)) * 10) / 10) : '0'
  let lineMode: LineMode = 'single'
  let lineValue = ''
  if (sp.line != null) {
    if (sp.lineRule === 'exact' || sp.lineRule === 'atLeast') {
      lineMode = sp.lineRule
      lineValue = String(twipToPt(sp.line))
    } else {
      const m = sp.line / 240
      lineMode = m === 1 ? 'single' : m === 1.5 ? 'onePointFive' : m === 2 ? 'double' : 'multiple'
      lineValue = lineMode === 'multiple' ? String(m) : ''
    }
  }
  return {
    jc: attrs.jc ?? '',
    outline: attrs.outlineLvl != null ? String(attrs.outlineLvl) : '',
    left: chars(ind.leftChars, ind.left),
    right: chars(ind.rightChars, ind.right),
    firstLine,
    firstWidth:
      firstLine === 'hanging'
        ? chars(ind.hangingChars, ind.hanging)
        : firstLine === 'indent'
          ? chars(ind.firstLineChars, ind.firstLine)
          : '1',
    before: lines(sp.beforeLines, sp.before),
    after: lines(sp.afterLines, sp.after),
    lineMode,
    lineValue
  }
}

const num = (s: string): number | null => {
  const n = Number(s.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
  return Number.isFinite(n) ? n : null
}

export function ParagraphDialog({
  editor,
  sizePt,
  onClose
}: {
  editor: Editor
  /** 字下げの目安に使う文字の大きさ (pt) */
  sizePt: number
  onClose: () => void
}): React.JSX.Element {
  const [values, setValues] = useState<Values>(() => initial(editor, sizePt))
  const [touched, setTouched] = useState<Set<keyof Values>>(new Set())
  const set = <K extends keyof Values>(key: K, value: Values[K]): void => {
    setValues((v) => ({ ...v, [key]: value }))
    setTouched((t) => new Set(t).add(key))
  }

  const apply = (): void => {
    const t = touched
    // 変更履歴を記録中なら、変える前の書式を先に抱えさせる (取引を作る前に)
    const names = new Set<string>()
    editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, (node) => {
      if (node.isTextblock) names.add(node.type.name)
      return !node.isTextblock
    })
    for (const name of names) recordParaFormatChange(editor, name)

    const tr = editor.state.tr
    const { from, to } = editor.state.selection
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true
      const attrs = { ...node.attrs } as Record<string, unknown>
      if (t.has('jc')) attrs['jc'] = values.jc || null
      if (t.has('outline') && 'outlineLvl' in attrs) attrs['outlineLvl'] = values.outline === '' ? null : Number(values.outline)

      if (t.has('left') || t.has('right') || t.has('firstLine') || t.has('firstWidth')) {
        const ind: ParagraphIndent = { ...((attrs['ind'] as ParagraphIndent | null) ?? {}) }
        if (t.has('left')) {
          delete ind.left
          ind.leftChars = Math.round((num(values.left) ?? 0) * 100)
        }
        if (t.has('right')) {
          delete ind.right
          ind.rightChars = Math.round((num(values.right) ?? 0) * 100)
        }
        if (t.has('firstLine') || t.has('firstWidth')) {
          delete ind.firstLine
          delete ind.firstLineChars
          delete ind.hanging
          delete ind.hangingChars
          const w = Math.round((num(values.firstWidth) ?? 0) * 100)
          if (values.firstLine === 'indent') ind.firstLineChars = w
          if (values.firstLine === 'hanging') ind.hangingChars = w
        }
        attrs['ind'] = ind
      }

      if (t.has('before') || t.has('after') || t.has('lineMode') || t.has('lineValue')) {
        const sp: ParagraphSpacing = { ...((attrs['spacing'] as ParagraphSpacing | null) ?? {}) }
        if (t.has('before')) {
          delete sp.before
          sp.beforeLines = Math.round((num(values.before) ?? 0) * 100)
        }
        if (t.has('after')) {
          delete sp.after
          sp.afterLines = Math.round((num(values.after) ?? 0) * 100)
        }
        if (t.has('lineMode') || t.has('lineValue')) {
          const v = num(values.lineValue)
          switch (values.lineMode) {
            case 'single':
              sp.line = 240
              sp.lineRule = 'auto'
              break
            case 'onePointFive':
              sp.line = 360
              sp.lineRule = 'auto'
              break
            case 'double':
              sp.line = 480
              sp.lineRule = 'auto'
              break
            case 'multiple':
              sp.line = Math.round((v ?? 1) * 240)
              sp.lineRule = 'auto'
              break
            case 'atLeast':
            case 'exact':
              sp.line = Math.round((v ?? sizePt) * 20)
              sp.lineRule = values.lineMode
              break
          }
        }
        attrs['spacing'] = sp
      }
      tr.setNodeMarkup(pos, undefined, attrs)
      return false
    })
    if (tr.docChanged) editor.view.dispatch(tr)
    editor.commands.focus()
    onClose()
  }

  const valueLabel =
    values.lineMode === 'multiple' ? '倍' : values.lineMode === 'atLeast' || values.lineMode === 'exact' ? 'pt' : ''

  return (
    <Dialog title="段落" open onClose={onClose} onSubmit={apply} width={480}>
      <div className="wowd-dialog-grid">
        <label htmlFor="para-jc">配置</label>
        <select id="para-jc" data-testid="para-jc" value={values.jc} onChange={(e) => set('jc', e.target.value as Justification | '')}>
          <option value="">(スタイルのまま)</option>
          <option value="left">左揃え</option>
          <option value="center">中央揃え</option>
          <option value="right">右揃え</option>
          <option value="both">両端揃え</option>
          <option value="distribute">均等割り付け</option>
        </select>
        <label htmlFor="para-outline">アウトライン レベル</label>
        <select id="para-outline" value={values.outline} onChange={(e) => set('outline', e.target.value)}>
          <option value="">本文</option>
          {Array.from({ length: 9 }, (_, i) => (
            <option key={i} value={String(i)}>
              レベル {i + 1}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="wowd-dialog-fieldset is-grid">
        <legend>インデント</legend>
        <label htmlFor="para-left">左</label>
        <span className="wowd-unit">
          <input id="para-left" data-testid="para-left" value={values.left} inputMode="decimal" onChange={(e) => set('left', e.target.value)} />字
        </span>
        <label htmlFor="para-right">右</label>
        <span className="wowd-unit">
          <input id="para-right" value={values.right} inputMode="decimal" onChange={(e) => set('right', e.target.value)} />字
        </span>
        <label htmlFor="para-first">最初の行</label>
        <span className="wowd-unit">
          <select
            id="para-first"
            data-testid="para-first"
            value={values.firstLine}
            onChange={(e) => set('firstLine', e.target.value as FirstLine)}
          >
            <option value="none">(なし)</option>
            <option value="indent">字下げ</option>
            <option value="hanging">ぶら下げ</option>
          </select>
          <input
            aria-label="幅"
            data-testid="para-first-width"
            value={values.firstWidth}
            inputMode="decimal"
            disabled={values.firstLine === 'none'}
            onChange={(e) => set('firstWidth', e.target.value)}
          />
          字
        </span>
      </fieldset>

      <fieldset className="wowd-dialog-fieldset is-grid">
        <legend>間隔</legend>
        <label htmlFor="para-before">段落前</label>
        <span className="wowd-unit">
          <input id="para-before" data-testid="para-before" value={values.before} inputMode="decimal" onChange={(e) => set('before', e.target.value)} />行
        </span>
        <label htmlFor="para-after">段落後</label>
        <span className="wowd-unit">
          <input id="para-after" value={values.after} inputMode="decimal" onChange={(e) => set('after', e.target.value)} />行
        </span>
        <label htmlFor="para-line">行間</label>
        <span className="wowd-unit">
          <select id="para-line" data-testid="para-line" value={values.lineMode} onChange={(e) => set('lineMode', e.target.value as LineMode)}>
            <option value="single">1 行</option>
            <option value="onePointFive">1.5 行</option>
            <option value="double">2 行</option>
            <option value="atLeast">最小値</option>
            <option value="exact">固定値</option>
            <option value="multiple">倍数</option>
          </select>
          <input
            aria-label="間隔"
            data-testid="para-line-value"
            value={values.lineValue}
            inputMode="decimal"
            disabled={valueLabel === ''}
            onChange={(e) => set('lineValue', e.target.value)}
          />
          {valueLabel}
        </span>
      </fieldset>
      <p className="wowd-dialog-note">変えた項目だけを、選んでいる段落すべてに当てます。</p>
    </Dialog>
  )
}
